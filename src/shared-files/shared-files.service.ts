import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { PrismaService } from '../prisma/prisma.service'

// Customer-facing share links — used by the frontend to deliver invoice/
// quotation PDFs via WhatsApp etc. Files live in a Cloudflare R2 bucket
// (S3-compatible) with public-read; security comes from the unguessable
// UUIDv4 in the object key plus a 90-day TTL. URLs are served from R2's
// edge, so they survive backend restarts and don't consume backend bandwidth.
@Injectable()
export class SharedFilesService implements OnModuleInit {
  private readonly logger = new Logger(SharedFilesService.name)
  private s3!: S3Client

  constructor(private readonly prisma: PrismaService) {}

  // Lazy-build the client so missing env vars only break shared-files,
  // not the whole app boot. Throws a clear error on first upload attempt.
  onModuleInit() {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      this.logger.warn(
        'R2 credentials not set (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY). ' +
        'Shared-file uploads will fail until these are configured.',
      )
      return
    }
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  }

  private get bucket(): string {
    const name = process.env.R2_BUCKET_NAME
    if (!name) throw new Error('R2_BUCKET_NAME is not set')
    return name
  }

  private get publicUrl(): string {
    const url = process.env.R2_PUBLIC_URL
    if (!url) throw new Error('R2_PUBLIC_URL is not set')
    return url.replace(/\/$/, '')
  }

  // Build the absolute URL the customer's phone will fetch. The key embeds
  // the user-facing filename so the URL itself is meaningful AND the file
  // downloads with that name on the customer's device.
  buildUrl(id: string, filename: string): string {
    return `${this.publicUrl}/${this.keyFor(id, filename)}`
  }

  // {uuid}/Quotation-QTN-26-27-00002.pdf — the UUID prefix keeps the URL
  // unguessable; the suffix is the human-friendly filename used on download.
  // We URL-encode the filename portion so spaces or unicode survive intact.
  private keyFor(id: string, filename: string): string {
    return `${id}/${encodeURIComponent(filename)}`
  }

  // Stream a PDF buffer into R2 with public-read at the bucket-policy level.
  // We don't pass an ACL here — R2 doesn't support per-object ACLs; the
  // bucket itself must have public access enabled (one-time setup).
  // ContentDisposition tells the browser to save the file with `filename`
  // when the customer taps Save, regardless of what URL fragment they got.
  async upload(buffer: Buffer, id: string, filename: string, contentType: string): Promise<void> {
    if (!this.s3) {
      throw new Error('R2 client not initialised — check R2_* env vars')
    }
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.keyFor(id, filename),
        Body: buffer,
        ContentType: contentType,
        ContentDisposition: `inline; filename="${filename}"`,
      }),
    )
  }

  async register(args: {
    id: string
    filename: string
    mimeType: string
    sizeBytes: number
    label: string | undefined
    createdById: string
    expiresInDays: number
  }) {
    const expiresAt = new Date(Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000)
    return this.prisma.sharedFile.create({
      data: {
        id: args.id,
        filename: args.filename,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        label: args.label,
        createdById: args.createdById,
        expiresAt,
      },
    })
  }

  // Daily cleanup. Removes expired DB rows AND the corresponding R2 objects
  // so the URLs naturally 404. Batched at 1000 keys per DeleteObjectsCommand
  // (R2's per-request cap matches S3's). We need both id + filename to
  // reconstruct the full R2 key, since the key format is `{id}/{filename}`.
  async cleanupExpired(): Promise<{ removed: number }> {
    const expired = await this.prisma.sharedFile.findMany({
      where: { expiresAt: { lt: new Date() } },
      select: { id: true, filename: true },
    })
    if (expired.length === 0) return { removed: 0 }

    if (this.s3) {
      // Chunk into 1000s to respect the S3/R2 DeleteObjects limit
      const chunks: { id: string; filename: string }[][] = []
      for (let i = 0; i < expired.length; i += 1000) {
        chunks.push(expired.slice(i, i + 1000))
      }
      for (const chunk of chunks) {
        try {
          await this.s3.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: chunk.map(r => ({ Key: this.keyFor(r.id, r.filename) })),
              },
            }),
          )
        } catch (err) {
          // Log and continue so the DB cleanup still happens — a stranded
          // R2 object is recoverable; a stuck DB row would block future runs.
          this.logger.warn(
            `R2 batch delete failed (${chunk.length} keys): ${(err as Error).message}`,
          )
        }
      }
    } else {
      this.logger.warn(
        `Skipping R2 delete for ${expired.length} expired key(s) — client not initialised`,
      )
    }

    await this.prisma.sharedFile.deleteMany({
      where: { id: { in: expired.map(r => r.id) } },
    })
    return { removed: expired.length }
  }
}
