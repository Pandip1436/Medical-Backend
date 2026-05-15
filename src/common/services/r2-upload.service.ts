import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// Generic Cloudflare R2 (S3-compatible) upload client. Intended to be shared
// across modules that need to persist user-uploaded artefacts — currently
// expense receipts; expandable to other features later.
@Injectable()
export class R2UploadService implements OnModuleInit {
  private readonly logger = new Logger(R2UploadService.name);
  private s3!: S3Client;

  onModuleInit() {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      this.logger.warn(
        'R2 credentials not set (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY). ' +
          'Uploads will fail until these are configured.',
      );
      return;
    }
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }

  private get bucket(): string {
    const name = process.env.R2_BUCKET_NAME;
    if (!name) throw new Error('R2_BUCKET_NAME is not set');
    return name;
  }

  private get publicUrl(): string {
    const url = process.env.R2_PUBLIC_URL;
    if (!url) throw new Error('R2_PUBLIC_URL is not set');
    return url.replace(/\/$/, '');
  }

  async upload(opts: {
    buffer: Buffer;
    key: string;
    contentType: string;
  }): Promise<string> {
    if (!this.s3) throw new Error('R2 client not initialised — check R2_* env vars');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: opts.key,
        Body: opts.buffer,
        ContentType: opts.contentType,
      }),
    );
    return `${this.publicUrl}/${opts.key}`;
  }

  // Best-effort delete — used when replacing/removing a receipt. Caller
  // should swallow errors (network blip shouldn't fail the user-facing
  // update; orphaned objects can be GC'd later).
  async delete(key: string): Promise<void> {
    if (!this.s3) return;
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // Extract the object key from a public URL we produced. Returns null if
  // the URL doesn't belong to our bucket (e.g. legacy receipts stored as
  // disk paths).
  keyFromUrl(url: string): string | null {
    try {
      const base = this.publicUrl;
      if (!url.startsWith(base + '/')) return null;
      return url.slice(base.length + 1);
    } catch {
      return null;
    }
  }
}
