import {
  DeleteObjectsCommand,
  DeleteObjectsOutput,
  GetObjectCommand,
  GetObjectOutput,
  HeadObjectCommand,
  HeadObjectOutput,
  ListObjectsV2Command,
  ListObjectsV2Output,
  PutObjectCommand,
  PutObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

/**
 * MinIO object storage, through the S3 client. Three kinds of object: gear
 * photos, import originals and rendered pack sheets. Every write is confirmed
 * present before the caller records anything, and an unreachable store is
 * reported to the caller as a plain storage failure.
 */

export class StorageUnavailableError extends Error {
  constructor() {
    super('storage unavailable');
  }
}

export interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

type AnyCommand = PutObjectCommand | HeadObjectCommand | GetObjectCommand | DeleteObjectsCommand | ListObjectsV2Command;

export class Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    this.bucket = config.bucket;
  }

  /** Makes sure the bucket exists; retried until it does. */
  async ensureBucket(): Promise<void> {
    for (;;) {
      const ok = await this.listPrefix('__probe__')
        .then(() => true)
        .catch(() => false);
      if (ok) return;
      await delay(2000);
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.send<PutObjectCommandOutput>(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
    await this.send<HeadObjectOutput>(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async get(key: string): Promise<Uint8Array> {
    const response = await this.send<GetObjectOutput>(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = response.Body;
    if (body === undefined) throw new StorageUnavailableError();
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as Readable) {
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : (chunk as Uint8Array));
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  /** Lists every object key under a prefix. */
  async listPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    for (;;) {
      const page = await this.send<ListObjectsV2Output>(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const entry of page.Contents ?? []) {
        if (entry.Key !== undefined) keys.push(entry.Key);
      }
      if (page.IsTruncated !== true) return keys;
      token = page.NextContinuationToken;
    }
  }

  /** Deletes an object and confirms it is gone. */
  async delete(key: string): Promise<void> {
    await this.send<DeleteObjectsOutput>(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: [{ Key: key }] } }));
    const listed = await this.send<ListObjectsV2Output>(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: key, MaxKeys: 1 }));
    if ((listed.Contents ?? []).some((entry) => entry.Key === key)) throw new StorageUnavailableError();
  }

  /** Deletes every object under a prefix and confirms the prefix lists none. */
  async deletePrefix(prefix: string): Promise<void> {
    for (;;) {
      const keys = await this.listPrefix(prefix);
      if (keys.length === 0) return;
      await this.send<DeleteObjectsOutput>(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((key) => ({ Key: key })) } }));
    }
  }

  private async send<T>(command: unknown): Promise<T> {
    try {
      return (await this.client.send(command as never)) as T;
    } catch {
      throw new StorageUnavailableError();
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
