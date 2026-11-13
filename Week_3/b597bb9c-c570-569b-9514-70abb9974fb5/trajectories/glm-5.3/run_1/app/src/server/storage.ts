import type { AppConfig } from './config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  GetObjectCommandOutput,
} from '@aws-sdk/client-s3';

/**
 * MinIO object storage: upload chunks, one object per checksum, manifests.
 * Every method reports liveness so callers can answer 503 cleanly.
 */
export class Storage {
  private client: S3Client;
  private bucket: string;
  private up = false;

  constructor(config: AppConfig) {
    this.bucket = config.s3.bucket;
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
  }

  isUp(): boolean {
    return this.up;
  }

  async probe(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.up = true;
    } catch {
      this.up = false;
    }
    return this.up;
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    if (!this.up) throw new Error('storage down');
    try {
      return await work();
    } catch (err) {
      if (err instanceof Error && err.message === 'storage down') throw err;
      this.up = false;
      throw new Error('storage down');
    }
  }

  async put(key: string, body: Uint8Array, contentType = 'application/octet-stream'): Promise<void> {
    await this.run(() =>
      this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
      ),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const response: GetObjectCommandOutput = await this.run(() =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (bytes === undefined) throw new Error('storage down');
    return bytes;
  }

  async remove(key: string): Promise<void> {
    await this.run(() =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
    );
  }
}
