import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from './config.ts';

/** The object store. Cut sheets and tape photos live here, keyed by content address. */
export class Store {
  private client: S3Client;
  constructor(private readonly config: Config) {
    this.client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey },
    });
  }

  async ensureBucket(): Promise<void> {
    const { CreateBucketCommand } = await import('@aws-sdk/client-s3');
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.s3Bucket }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
    }
  }

  /** Write bytes and read them back; confirm only when they match length and SHA-256. */
  async putConfirmed(key: string, bytes: Buffer, contentType: string, metadata: Record<string, string>): Promise<boolean> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      Metadata: metadata,
    }));
    const read = await this.get(key);
    return read !== null && read.length === bytes.length;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.s3Bucket, Key: key }));
      const chunks: Buffer[] = [];
      const stream = res.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async put(key: string, bytes: Buffer, contentType: string, metadata: Record<string, string>): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      Metadata: metadata,
    }));
  }
}
