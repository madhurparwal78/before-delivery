import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from './config.js';

export class StorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: Config) {
    this.bucket = config.s3Bucket;
    this.client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey },
    });
  }

  async reachable(): Promise<boolean> {
    try {
      await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: 'lineboard-health-probe' }));
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey') return true;
      // Metadata and access errors still mean the endpoint answers.
      const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code && code < 500) return true;
      return false;
    }
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const chunks: Buffer[] = [];
      const stream = result.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey') return null;
      throw err;
    }
  }
}
