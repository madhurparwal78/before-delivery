import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Env } from '../env.js';

/** Real S3 calls against S3_ENDPOINT; the bucket already exists and stays private. */
export class StorageClient {
  private readonly env: Env;
  private client: S3Client | null = null;

  constructor(env: Env) {
    this.env = env;
  }

  private s3(): S3Client {
    if (this.client === null) {
      this.client = new S3Client({
        region: this.env.S3_REGION,
        endpoint: this.env.S3_ENDPOINT,
        forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: this.env.S3_ACCESS_KEY_ID,
          secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
        },
      });
    }
    return this.client;
  }

  async putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<void> {
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
  }

  /** A HEAD that confirms the stored object matches the row we are about to commit. */
  async confirmObject(input: {
    key: string;
    sizeBytes: number;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<boolean> {
    try {
      const head = await this.s3().send(
        new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: input.key }),
      );
      const size = head.ContentLength;
      const contentType = head.ContentType ?? '';
      const meta = head.Metadata ?? {};
      if (size !== input.sizeBytes || contentType !== input.contentType) return false;
      for (const [key, value] of Object.entries(input.metadata)) {
        if ((meta[key] ?? '') !== value) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const result = await this.s3().send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      const chunks: Buffer[] = [];
      if (result.Body) {
        for await (const chunk of result.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.s3().send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
    } catch {
      // Deleting an object that never landed is a no-op.
    }
  }

  async headOk(key: string): Promise<boolean> {
    try {
      await this.s3().send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
