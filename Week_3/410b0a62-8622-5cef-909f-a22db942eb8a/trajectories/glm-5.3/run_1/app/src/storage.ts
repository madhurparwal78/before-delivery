import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { AppConfig } from './config.js';

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export interface StoredObject {
  key: string;
  size: number;
  sha256: string;
  contentType: string;
  filename: string;
}

export class ObjectStorage {
  private client: S3Client;
  private readonly bucket: string;
  private readonly uploadTimeoutMs: number;

  constructor(config: AppConfig) {
    this.bucket = config.s3.bucket;
    this.uploadTimeoutMs = config.uploadTimeoutMs;
    this.client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
      requestHandler: {
        requestTimeout: config.uploadTimeoutMs,
        connectionTimeout: Math.min(config.uploadTimeoutMs, 2000),
      } as never,
    });
  }

  private async withTimeout<T>(op: () => Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StorageUnavailableError('storage timeout')), ms);
    });
    try {
      return await Promise.race([op(), timeout]);
    } catch (err) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError((err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  async ensureBucket(): Promise<boolean> {
    try {
      await this.withTimeout(() => this.client.send(new HeadBucketCommand({ Bucket: this.bucket })), this.uploadTimeoutMs);
      return true;
    } catch (err) {
      if (err instanceof StorageUnavailableError && err.message === 'storage timeout') return false;
      const name = (err as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchBucket') return false;
      return false;
    }
  }

  async put(obj: StoredObject, bytes: Buffer): Promise<void> {
    await this.withTimeout(
      () =>
        this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: obj.key,
            Body: bytes,
            ContentType: obj.contentType,
            Metadata: { sha256: obj.sha256, filename: obj.filename },
          })
        ),
      this.uploadTimeoutMs
    );
  }

  /** Reads back the stored object's size and sha256 metadata. */
  async stat(key: string): Promise<{ size: number; sha256: string; filename: string } | null> {
    const res = await this.withTimeout(
      () => this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })),
      this.uploadTimeoutMs
    );
    const metadata = res.Metadata ?? {};
    return {
      size: res.ContentLength ?? 0,
      sha256: metadata.sha256 ?? '',
      filename: metadata.filename ?? '',
    };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.withTimeout(
      () => this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
      this.uploadTimeoutMs
    );
    const body = res.Body;
    if (!body) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    for await (const chunk of body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.withTimeout(
      () => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
      this.uploadTimeoutMs
    );
  }
}
