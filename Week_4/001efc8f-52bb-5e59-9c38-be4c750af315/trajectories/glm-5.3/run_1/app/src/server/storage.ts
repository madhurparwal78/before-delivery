import { DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { Config } from './config';

export interface StoredObject {
  key: string;
  body: Buffer;
  contentType: string;
}

/** A thin S3 wrapper; every failure here is reported as storage unavailable by callers. */
export class Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private available = false;

  constructor(config: Config) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
    this.bucket = config.s3.bucket;
  }

  async check(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  setAvailable(v: boolean): void {
    this.available = v;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: { Objects: [{ Key: key }] },
    }));
  }

  async removeMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.send(new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: { Objects: keys.map((key) => ({ Key: key })) },
    }));
  }

  async listPrefix(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const obj of res.Contents ?? []) if (obj.Key) out.push(obj.Key);
      token = res.NextContinuationToken;
    } while (token);
    return out;
  }
}
