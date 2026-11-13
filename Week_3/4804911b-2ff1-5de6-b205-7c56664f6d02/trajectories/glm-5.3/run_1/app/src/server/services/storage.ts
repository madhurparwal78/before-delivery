import * as Minio from 'minio';
import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config.js';

/** MinIO holds immutable bytes: notice PDFs and original sheets, one object each, never rewritten or removed. */
export class Storage {
  private client: Minio.Client;
  private lastContactOk = true;
  private lastContactAt = 0;

  constructor(private config: Config) {
    const url = new URL(config.s3Endpoint);
    this.client = new Minio.Client({
      endPoint: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      useSSL: url.protocol === 'https:',
      accessKey: config.s3AccessKeyId,
      secretKey: config.s3SecretAccessKey,
      region: config.s3Region,
    });
  }

  private ensureBucket(): Promise<void> {
    const run = async (): Promise<void> => {
      const exists = await this.client.bucketExists(this.config.s3Bucket);
      if (!exists) await this.client.makeBucket(this.config.s3Bucket, this.config.s3Region);
    };
    return this.withContact(run);
  }

  async withContact<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn();
      this.lastContactOk = true;
      this.lastContactAt = Date.now();
      return r;
    } catch (e) {
      this.lastContactOk = false;
      this.lastContactAt = Date.now();
      throw e;
    }
  }

  get reachable(): boolean {
    if (!this.lastContactOk && Date.now() - this.lastContactAt < 15000) return false;
    return true;
  }

  noteUnreachable(): void {
    this.lastContactOk = false;
    this.lastContactAt = Date.now();
  }

  async init(): Promise<void> {
    try {
      await this.ensureBucket();
    } catch {
      // an unreachable dependency counts as down; the server keeps running
    }
  }

  async contact(): Promise<boolean> {
    try {
      await this.client.bucketExists(this.config.s3Bucket);
      this.lastContactOk = true;
      this.lastContactAt = Date.now();
      return true;
    } catch {
      this.lastContactOk = false;
      this.lastContactAt = Date.now();
      return false;
    }
  }

  async putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.withContact(() =>
      this.client.putObject(this.config.s3Bucket, key, bytes, bytes.length, { 'Content-Type': contentType })
    );
  }

  async getObject(key: string): Promise<Buffer> {
    return this.withContact(async () => {
      const stream = await this.client.getObject(this.config.s3Bucket, key);
      const parts: Buffer[] = [];
      for await (const chunk of stream) parts.push(chunk as Buffer);
      return Buffer.concat(parts);
    });
  }

  async statObject(key: string): Promise<{ size: number; etag: string; lastModified: Date } | null> {
    return this.withContact(async () => {
      const s = await this.client.statObject(this.config.s3Bucket, key);
      return { size: s.size, etag: s.etag ?? '', lastModified: s.lastModified };
    });
  }

  /** Presigned GET for the host in MINIO_PUBLIC_URL, living 60 seconds. */
  async presignGet(key: string): Promise<string> {
    if (this.config.minioPublicUrl !== this.config.s3Endpoint) {
      // Presign for the public host by rewriting the signed query onto that base.
      const publicUrl = new URL(this.config.minioPublicUrl);
      const inner = new Minio.Client({
        endPoint: publicUrl.hostname,
        port: Number(publicUrl.port || (publicUrl.protocol === 'https:' ? 443 : 80)),
        useSSL: publicUrl.protocol === 'https:',
        accessKey: this.config.s3AccessKeyId,
        secretKey: this.config.s3SecretAccessKey,
        region: this.config.s3Region,
      });
      return this.withContact(() => inner.presignedUrl('GET', this.config.s3Bucket, key, 60, { region: this.config.s3Region }));
    }
    return this.withContact(() => this.client.presignedUrl('GET', this.config.s3Bucket, key, 60, { region: this.config.s3Region }));
  }

  sha256(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  randomId(): string {
    return randomBytes(12).toString('hex');
  }
}
