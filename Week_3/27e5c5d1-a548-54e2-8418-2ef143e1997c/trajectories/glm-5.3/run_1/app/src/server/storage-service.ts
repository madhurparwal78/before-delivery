import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type { AppConfig } from './config.js';

export interface StoredObject {
  key: string;
  contentType: string;
  size: number;
  body: Buffer;
}

export interface StorageDriver {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  remove(keys: string[]): Promise<void>;
  ping(): Promise<boolean>;
}

class S3Storage implements StorageDriver {
  private readonly client: S3Client;
  constructor(private readonly config: AppConfig['s3']) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }
  async get(key: string): Promise<StoredObject> {
    const reply: GetObjectCommandOutput = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    const body = reply.Body;
    if (!body) throw new Error('empty object');
    const chunks: Buffer[] = [];
    const stream = body as unknown as AsyncIterable<Buffer>;
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return {
      key,
      contentType: reply.ContentType ?? 'application/octet-stream',
      size: reply.ContentLength ?? 0,
      body: Buffer.concat(chunks),
    };
  }
  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: { Objects: keys.map((k) => ({ Key: k })) },
      }),
    );
  }
  async ping(): Promise<boolean> {
    try {
      await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: 'kinfold-healthcheck-ping' }));
      return true;
    } catch (error) {
      const name = (error as { name?: string }).name ?? '';
      if (name === 'NoSuchKey') return true;
      return false;
    }
  }
}

export interface StorageHealth {
  isUp(): boolean;
  check(): void;
}

/**
 * The storage seam: uploads, downloads, deletions and outage detection decided once.
 * The app serves in a degraded state when MinIO is unreachable and recovers by itself.
 */
export class StorageService {
  private driver: StorageDriver;
  private up = false;
  private lastCheckAt = 0;
  private readonly probeIntervalMs = 3_000;

  constructor(config: AppConfig) {
    this.driver = new S3Storage(config.s3);
  }

  isUp(): boolean {
    return this.up;
  }

  private async refreshUp(): Promise<void> {
    this.lastCheckAt = Date.now();
    try {
      this.up = await this.driver.ping();
    } catch {
      this.up = false;
    }
  }

  /** Track health at most every probeIntervalMs; the banner rules need 5s detection and 10s recovery. */
  async ensureChecked(): Promise<void> {
    if (Date.now() - this.lastCheckAt >= this.probeIntervalMs) {
      await this.refreshUp();
    }
  }

  async putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.driver.put(key, bytes, contentType);
    await this.refreshUp();
  }

  async getObject(key: string): Promise<StoredObject> {
    const result = await this.driver.get(key);
    await this.refreshUp();
    return result;
  }

  async removeObjects(keys: string[]): Promise<void> {
    await this.driver.remove(keys);
    await this.refreshUp();
  }

  startMonitoring(): void {
    void this.refreshUp();
    const timer = setInterval(() => {
      void this.refreshUp();
    }, this.probeIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }
}
