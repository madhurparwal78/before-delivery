import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Config } from './db.js';
import { sha256Hex } from './crypto.js';

export class Store {
  private client: S3Client;
  constructor(private cfg: Config) {
    this.client = new S3Client({
      endpoint: cfg.s3.endpoint,
      region: cfg.s3.region,
      forcePathStyle: cfg.s3.forcePathStyle,
      credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.s3.bucket }));
    } catch {
      try { await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.s3.bucket })); } catch { /* created concurrently by another instance */ }
    }
  }

  /** Store one object, returning its sha256; throws when MinIO is unreachable. */
  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.s3.bucket, Key: key, Body: body, ContentType: contentType }));
    return sha256Hex(body);
  }

  async get(key: string): Promise<Buffer> {
    const reply = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.s3.bucket, Key: key }));
    const bytes = await reply.Body?.transformToByteArray();
    if (!bytes) throw new Error('empty object');
    return Buffer.from(bytes);
  }

  async del(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.s3.bucket, Key: key }));
  }

  originalKey(carId: string, uploadId: string): string { return `originals/${carId}/${uploadId}`; }
  derivativeKey(carId: string, uploadId: string): string { return `derivatives/${carId}/${uploadId}.jpg`; }
  reportKey(carId: string, version: number): string { return `reports/${carId}/v${version}.pdf`; }
  handoverKey(carId: string): string { return `handover/${carId}.pdf`; }
}
