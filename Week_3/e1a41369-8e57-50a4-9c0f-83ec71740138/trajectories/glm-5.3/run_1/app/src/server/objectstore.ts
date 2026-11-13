import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import type { AppConfig } from './config.js';

export interface StoredObject {
  key: string;
  bytes: Buffer;
  contentType: string;
}

/**
 * The object store client. Every credential comes from the environment.
 * All failures surface as `storage unavailable` to the caller.
 */
export class ObjectStore {
  private client: S3Client;
  private bucket: string;
  private bucketReady = false;

  constructor(cfg: AppConfig['s3']) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    this.bucket = cfg.bucket;
  }

  async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketReady = true;
      return;
    } catch {
      // fall through to create
    }
    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    this.bucketReady = true;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType })
    );
  }

  async get(key: string): Promise<Buffer> {
    await this.ensureBucket();
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

/** Detect image type from leading bytes: PNG or JPEG only. */
export function detectImageType(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.subarray(0, 4).toString('hex') === '89504e47') {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

export const IMPORT_MAX_BYTES = 100000;
export const BANNER_MAX_BYTES = 2000000;
export const DEEDLIST_EXT = '.deedlist';
