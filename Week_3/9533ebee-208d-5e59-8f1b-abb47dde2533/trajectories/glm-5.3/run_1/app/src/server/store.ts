import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CreateBucketCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getConfig } from './config.js';

export class StatementStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor() {
    const cfg = getConfig();
    this.client = new S3Client({
      endpoint: cfg.s3.endpoint,
      region: cfg.s3.region,
      forcePathStyle: cfg.s3.forcePathStyle,
      credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
    });
    this.bucket = cfg.s3.bucket;
  }

  async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.bucketReady = true;
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') {
        this.bucketReady = true;
        return;
      }
      throw err;
    }
  }

  async putOnce(key: string, body: string | Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      return bytes ?? null;
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchKey') return false;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      // best effort: the commit path reports failure before this matters
    }
  }
}
