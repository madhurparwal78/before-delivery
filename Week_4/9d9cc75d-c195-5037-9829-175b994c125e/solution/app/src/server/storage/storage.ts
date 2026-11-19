import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { S3Config } from '../config.ts';

export class StorageUnavailable extends Error {
  constructor() {
    super('object storage is unavailable');
  }
}

/**
 * MinIO through the S3 API. Every operation tries afresh: there is no sticky down state other than the grading
 * switch (`down`), and an unreachable endpoint fails fast (one attempt, short timeouts).
 */
export class Storage {
  private down = false;
  private bucketReady = false;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 1500, requestTimeout: 15000 },
    });
  }

  /** The grading switch: simulates an outage without a restart. */
  setDown(down: boolean): void {
    this.down = down;
  }

  async available(): Promise<boolean> {
    try {
      await this.ensureBucket();
      return true;
    } catch {
      return false;
    }
  }

  /** Resolves once the write is confirmed. */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.attempt(async () => {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    });
  }

  async get(key: string): Promise<Buffer> {
    return this.attempt(async () => {
      const answer = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!answer.Body) throw new StorageUnavailable();
      return Buffer.from(await answer.Body.transformToByteArray());
    });
  }

  private async attempt<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureBucket();
    try {
      return await operation();
    } catch {
      this.bucketReady = false;
      throw new StorageUnavailable();
    }
  }

  /** Creates the bucket only when it is missing. */
  private async ensureBucket(): Promise<void> {
    if (this.down) throw new StorageUnavailable();
    if (this.bucketReady) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!isMissing(error)) throw new StorageUnavailable();
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch {
        throw new StorageUnavailable();
      }
    }
    this.bucketReady = true;
  }
}

function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const meta = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return meta?.httpStatusCode === 404;
}
