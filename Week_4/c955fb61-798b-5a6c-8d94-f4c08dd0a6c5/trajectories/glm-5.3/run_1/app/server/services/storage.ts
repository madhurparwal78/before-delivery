// MinIO through the AWS SDK. Downloads stream from here; the browser never talks to MinIO.

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Readable | null> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return (result.Body as Readable | undefined) ?? null;
  }

  async head(key: string): Promise<void> {
    await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
