import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

  // Default bucket — the one with R2.dev public access enabled. Used for
  // user-facing artefacts (expense receipts, shared invoice PDFs).
  private get bucket(): string {
    const name = process.env.R2_BUCKET_NAME;
    if (!name) throw new Error('R2_BUCKET_NAME is not set');
    return name;
  }

  // Resolve the bucket name for any operation. Pass an explicit name to use
  // a different bucket (e.g. the dedicated private backups bucket). Default:
  // the public bucket from R2_BUCKET_NAME.
  private resolveBucket(override?: string): string {
    return override && override.length > 0 ? override : this.bucket;
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
  // Pass `bucket` to target a non-default bucket (e.g. the backups bucket).
  async delete(key: string, bucket?: string): Promise<void> {
    if (!this.s3) return;
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.resolveBucket(bucket), Key: key }));
  }

  // Upload an object that should NOT be exposed via a public URL. Recommended
  // target: a dedicated bucket with R2.dev public access DISABLED (pass via
  // `bucket` param). If `bucket` is omitted we fall back to the default bucket
  // — that fallback is only safe when the object key is unguessable, since
  // the default bucket has R2.dev public access enabled. Prefer passing a
  // dedicated private bucket for anything sensitive.
  async uploadPrivate(opts: {
    buffer: Buffer;
    key: string;
    contentType: string;
    bucket?: string;
  }): Promise<void> {
    if (!this.s3) throw new Error('R2 client not initialised — check R2_* env vars');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.resolveBucket(opts.bucket),
        Key: opts.key,
        Body: opts.buffer,
        ContentType: opts.contentType,
      }),
    );
  }

  // Issue a short-lived presigned GET URL for downloading a private object.
  // Default TTL = 15 minutes (long enough to start a download from a remote
  // browser, short enough that leaked URLs become useless quickly).
  //
  // Optional `responseContentDisposition` and `responseContentType` are
  // per-request overrides that S3/R2 echo back in the response headers.
  // Critical for download flows: without an explicit
  // `Content-Disposition: attachment` the browser may render the body inline
  // (or worse, Cloudflare may auto-decompress and rename based on
  // `Content-Encoding`). Pass an attachment filename to force a download
  // with a stable filename.
  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds = 900,
    bucket?: string,
    overrides?: { responseContentDisposition?: string; responseContentType?: string },
  ): Promise<string> {
    if (!this.s3) throw new Error('R2 client not initialised — check R2_* env vars');
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.resolveBucket(bucket),
        Key: key,
        ResponseContentDisposition: overrides?.responseContentDisposition,
        ResponseContentType: overrides?.responseContentType,
      }),
      { expiresIn: expiresInSeconds },
    );
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
