import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../config.js';

export interface StorageLike {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  presign(key: string, seconds: number): Promise<string>;
  probe(): Promise<boolean>;
}

class StorageClient implements StorageLike {
  private client: S3Client;
  constructor() {
    this.client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: config.s3Bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async presign(key: string, seconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }), { expiresIn: seconds });
  }

  async probe(): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: 'probe/ping' }));
      return true;
    } catch (err) {
      const name = (err as Error).name ?? '';
      return name === 'NotFound' || name === 'NoSuchKey';
    }
  }
}

export function createStorage(): StorageLike {
  return new StorageClient();
}
