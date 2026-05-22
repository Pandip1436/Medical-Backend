import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { gzip as gzipCb } from 'zlib';
import { promisify } from 'util';
import { Backup, BackupStatus, BackupTrigger } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { R2UploadService } from '../common/services/r2-upload.service';
import { MODELS_TO_BACKUP } from './models-to-backup';

const gzip = promisify(gzipCb);

// Cap on how many COMPLETED rows we keep. Older COMPLETED + their R2 objects
// get swept by the scheduler. FAILED rows are left alone for admin triage.
const RETENTION_KEEP = 30;

// Retry once on transient Prisma connection errors. Neon serverless drops
// idle connections aggressively; the next query auto-reconnects but the
// in-flight one throws. A single short retry usually clears it. Without
// this, the scheduled 02:00 IST backup fails every time a table-loop pause
// exceeds Neon's idle threshold.
async function findManyWithRetry(
  delegate: { findMany: () => Promise<unknown[]> },
  modelName: string,
  logger: Logger,
): Promise<unknown[]> {
  try {
    return await delegate.findMany();
  } catch (err) {
    const msg = (err as Error).message ?? '';
    const code = (err as { code?: string }).code;
    const isTransient =
      code === 'P1001' || // Can't reach database server
      code === 'P1017' || // Server has closed the connection
      /closed the connection|connection.*terminat|reset by peer/i.test(msg);
    if (!isTransient) throw err;
    logger.warn(
      `Transient DB error on findMany(${modelName}) — retrying once after 500ms: ${msg}`,
    );
    await new Promise((r) => setTimeout(r, 500));
    return delegate.findMany();
  }
}

function formatStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  // Name of the dedicated private bucket for backups. Read from
  // R2_BACKUP_BUCKET_NAME. If unset we fall back to the default public bucket
  // — see the warning in onModuleInit() about why that's risky.
  private backupBucket: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2UploadService,
  ) {}

  onModuleInit() {
    this.backupBucket = process.env.R2_BACKUP_BUCKET_NAME?.trim() || undefined;
    if (!this.backupBucket) {
      this.logger.warn(
        'R2_BACKUP_BUCKET_NAME is not set — backups will land in the default ' +
          'bucket (R2_BUCKET_NAME), which has R2.dev public access enabled. ' +
          'Object keys are cuid-random and effectively unguessable, but for ' +
          'medical/financial data the safer setup is a dedicated bucket with ' +
          'R2.dev access DISABLED. Create one in the Cloudflare dashboard and ' +
          'set R2_BACKUP_BUCKET_NAME to its name to switch.',
      );
    } else {
      this.logger.log(`Backups will be stored in dedicated bucket: ${this.backupBucket}`);
    }
  }

  /**
   * Run a full backup. Returns the persisted `Backup` row (COMPLETED on
   * success, FAILED with `errorMessage` on error — the row is always created
   * so the UI can show a history entry even for failures).
   *
   * Notes:
   *   - This is synchronous from the caller's perspective (HTTP POST blocks
   *     for the duration). At current DB size (~5-10 MB raw) the whole run
   *     takes 10-30s. If the DB grows past ~100 MB raw we'll need to switch
   *     to a streaming/background-job pattern.
   *   - We deliberately build the whole JSONL in memory before gzipping;
   *     simpler than streaming and avoids tmp-file lifecycle.
   */
  async run(trigger: BackupTrigger, userId?: string): Promise<Backup> {
    const now = new Date();
    const filename = `pbims-${formatStamp(now)}.jsonl.gz`;

    // Step 1 — insert IN_PROGRESS row first so the UI can render the
    // "currently running" entry while the work is happening.
    const row = await this.prisma.backup.create({
      data: {
        filename,
        r2Key: '', // filled in after we know the cuid id
        trigger,
        status: BackupStatus.IN_PROGRESS,
        createdById: userId ?? null,
      },
    });
    const r2Key = `backups/${row.id}.jsonl.gz`;
    await this.prisma.backup.update({ where: { id: row.id }, data: { r2Key } });

    try {
      // Step 2 — build the JSONL payload. One line per record, prefixed by
      // delimiter lines so a reader can route rows to the right table.
      const lines: string[] = [];
      lines.push(JSON.stringify({ _meta: 'pbims-backup', version: 1, createdAt: now.toISOString() }));

      let totalRows = 0;
      for (const m of MODELS_TO_BACKUP) {
        lines.push(JSON.stringify({ _table: m.name }));
        // The Prisma client is a JS object indexed by camelCase model name.
        // We've kept the `prismaKey` field on each entry deliberately so this
        // cast is the only `any` in the loop.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delegate = (this.prisma as any)[m.prismaKey];
        if (!delegate || typeof delegate.findMany !== 'function') {
          this.logger.warn(`Skipping ${m.name}: no findMany delegate on Prisma client`);
          continue;
        }
        const rows = await findManyWithRetry(delegate, m.name, this.logger);
        totalRows += rows.length;
        for (const r of rows) lines.push(JSON.stringify(r));
      }

      const raw = Buffer.from(lines.join('\n'), 'utf8');
      const gz = await gzip(raw);

      // Step 3 — upload to R2. Use the dedicated backup bucket if configured,
      // else fall back to the default bucket (already warned at startup).
      await this.r2.uploadPrivate({
        buffer: gz,
        key: r2Key,
        contentType: 'application/gzip',
        bucket: this.backupBucket,
      });

      // Step 4 — finalise the row
      return this.prisma.backup.update({
        where: { id: row.id },
        data: {
          status: BackupStatus.COMPLETED,
          sizeBytes: gz.length,
          rowCount: totalRows,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      this.logger.error(`Backup ${row.id} failed: ${message}`);
      await this.prisma.backup.update({
        where: { id: row.id },
        data: {
          status: BackupStatus.FAILED,
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  async list(limit = 100) {
    return this.prisma.backup.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
  }

  async getDownloadUrl(id: string): Promise<{ url: string; expiresAt: string }> {
    const row = await this.prisma.backup.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Backup not found');
    if (row.status !== BackupStatus.COMPLETED) {
      throw new NotFoundException('Backup is not downloadable (not COMPLETED)');
    }
    const ttlSeconds = 900;
    // Force the browser to save the file with the right filename. Without
    // these overrides, Cloudflare's edge advertises `Content-Encoding: gzip`
    // + `Content-Type: text/plain`, which makes the browser try to inline-
    // render and/or auto-decompress (breaks the download — see backup
    // post-mortem 2026-05-20). `application/octet-stream` tells Cloudflare
    // "opaque binary, don't be clever".
    const safeFilename = row.filename.replace(/[^A-Za-z0-9._-]/g, '_');
    const url = await this.r2.getSignedDownloadUrl(
      row.r2Key,
      ttlSeconds,
      this.backupBucket,
      {
        responseContentDisposition: `attachment; filename="${safeFilename}"`,
        responseContentType: 'application/octet-stream',
      },
    );
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    return { url, expiresAt };
  }

  async remove(id: string): Promise<void> {
    const row = await this.prisma.backup.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Backup not found');
    if (row.r2Key) {
      try {
        await this.r2.delete(row.r2Key, this.backupBucket);
      } catch (err) {
        // Best-effort — orphan R2 objects can be GC'd separately.
        this.logger.warn(`Failed to delete R2 object ${row.r2Key}: ${(err as Error).message}`);
      }
    }
    await this.prisma.backup.delete({ where: { id } });
  }

  /**
   * Retention sweep — keep the {@link RETENTION_KEEP} newest COMPLETED rows;
   * delete older ones (+ their R2 objects). FAILED rows are left in place so
   * admins can see + clear them manually.
   */
  async sweepRetention(): Promise<{ deleted: number }> {
    const completed = await this.prisma.backup.findMany({
      where: { status: BackupStatus.COMPLETED },
      orderBy: { createdAt: 'desc' },
      select: { id: true, r2Key: true },
    });
    const toDelete = completed.slice(RETENTION_KEEP);
    if (toDelete.length === 0) return { deleted: 0 };

    for (const row of toDelete) {
      if (row.r2Key) {
        try {
          await this.r2.delete(row.r2Key, this.backupBucket);
        } catch (err) {
          this.logger.warn(
            `Retention sweep: failed to delete R2 object ${row.r2Key}: ${(err as Error).message}`,
          );
        }
      }
    }
    await this.prisma.backup.deleteMany({
      where: { id: { in: toDelete.map((r) => r.id) } },
    });
    return { deleted: toDelete.length };
  }
}
