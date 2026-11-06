import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

export interface EvidenceConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class EvidenceStore {
  private client: S3Client;
  readonly bucket: string;
  available = true;

  constructor(cfg: EvidenceConfig) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch {
        /* another instance may have created it first */
      }
    }
  }

  async probe(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType })
    );
  }

  /** Streams the whole object into memory; evidence files are at most 5 MB. */
  async getBytes(key: string): Promise<Buffer | null> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = res.Body as unknown;
    if (body === null || body === undefined) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
