import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { Config } from '../config.js';
import { storageUnavailable } from '../errors.js';

export interface StoredObject {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export class Storage {
  private client: S3Client;
  private readonly bucket: string;

  constructor(config: Config) {
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

  async put(obj: StoredObject): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: obj.key,
          Body: obj.body,
          ContentType: obj.contentType,
          Metadata: obj.metadata,
        }),
      );
    } catch (e) {
      throw storageUnavailable();
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const stream = res.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as never));
      }
      return Buffer.concat(chunks);
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NoSuchKey') return null;
      throw storageUnavailable();
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      throw storageUnavailable();
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchKey') return false;
      throw storageUnavailable();
    }
  }
}
