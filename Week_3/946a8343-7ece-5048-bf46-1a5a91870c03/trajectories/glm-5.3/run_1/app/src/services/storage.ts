import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { S3Config } from '../core/config.js';
import type { Clock } from '../core/util.js';

export interface Stored {
  key: string;
  size: number;
}

export interface FileStorage {
  put(key: string, data: string | Uint8Array): Promise<Stored>;
  get(key: string): Promise<string | null>;
  head(key: string): Promise<number | null>;
  del(key: string): Promise<void>;
  healthy(): Promise<boolean>;
  sizeLimit(): number;
}

export class S3Storage implements FileStorage {
  private client: S3Client | null = null;
  private readonly cfg: S3Config;
  private readonly bucket: string;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
    this.bucket = cfg.bucket;
  }

  private s3(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        endpoint: this.cfg.endpoint,
        region: this.cfg.region,
        forcePathStyle: this.cfg.forcePathStyle,
        credentials: { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey },
      });
    }
    return this.client;
  }

  private async ensureBucket(): Promise<void> {
    await this.s3().send(new PutObjectCommand({ Bucket: this.bucket, Key: '_spurline/health', Body: 'ok' }));
  }

  async put(key: string, data: string | Uint8Array): Promise<Stored> {
    const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    await this.s3().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body }));
    return { key, size: body.byteLength };
  }

  async get(key: string): Promise<string | null> {
    try {
      const r = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!r.Body) return null;
      const bytes = await r.Body.transformToString('utf8');
      return bytes;
    } catch {
      return null;
    }
  }

  async head(key: string): Promise<number | null> {
    try {
      const r = await this.s3().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.ContentLength ?? 0;
    } catch {
      return null;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      // ignore
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.ensureBucket();
      return true;
    } catch {
      return false;
    }
  }

  sizeLimit(): number {
    return Number.MAX_SAFE_INTEGER;
  }
}

export class DownStorage implements FileStorage {
  async put(): Promise<Stored> {
    throw new Error('unavailable');
  }
  async get(): Promise<string | null> {
    throw new Error('unavailable');
  }
  async head(): Promise<number | null> {
    throw new Error('unavailable');
  }
  async del(): Promise<void> {
    throw new Error('unavailable');
  }
  healthy(): Promise<boolean> {
    return Promise.resolve(false);
  }
  sizeLimit(): number {
    return Number.MAX_SAFE_INTEGER;
  }
}

class Managed implements FileStorage {
  private inner: FileStorage;
  private forcedDown: boolean;
  private readonly clock: Clock;
  private readonly cfg: S3Config;

  constructor(cfg: S3Config, clock: Clock) {
    this.cfg = cfg;
    this.clock = clock;
    this.forcedDown = false;
    this.inner = new S3Storage(cfg);
  }

  setDown(down: boolean): void {
    this.forcedDown = down;
  }

  isForcedDown(): boolean {
    return this.forcedDown;
  }

  private active(): FileStorage {
    return this.forcedDown ? downStorageShared : this.inner;
  }

  async put(key: string, data: string | Uint8Array): Promise<Stored> {
    return this.active().put(key, data);
  }
  async get(key: string): Promise<string | null> {
    return this.active().get(key);
  }
  async head(key: string): Promise<number | null> {
    return this.active().head(key);
  }
  async del(key: string): Promise<void> {
    return this.active().del(key);
  }
  async healthy(): Promise<boolean> {
    if (this.forcedDown) return false;
    try {
      return await this.inner.healthy();
    } catch {
      return false;
    }
  }
  sizeLimit(): number {
    return Number.MAX_SAFE_INTEGER;
  }
}

const downStorageShared = new DownStorage();

export class StorageService implements FileStorage {
  private managed: Managed | null = null;

  constructor(cfg: S3Config | null, clock: Clock) {
    if (cfg) this.managed = new Managed(cfg, clock);
  }

  get available(): boolean {
    return this.managed !== null;
  }

  setDown(down: boolean): void {
    this.managed?.setDown(down);
  }

  isForcedDown(): boolean {
    return this.managed?.isForcedDown() ?? false;
  }

  async put(key: string, data: string | Uint8Array): Promise<Stored> {
    return this.require().put(key, data);
  }
  async get(key: string): Promise<string | null> {
    return this.require().get(key);
  }
  async head(key: string): Promise<number | null> {
    return this.require().head(key);
  }
  async del(key: string): Promise<void> {
    return this.require().del(key);
  }
  async healthy(): Promise<boolean> {
    if (!this.managed) return false;
    return this.managed.healthy();
  }
  async tryGet(key: string): Promise<string | null> {
    try {
      return await this.get(key);
    } catch {
      return null;
    }
  }
  async tryHead(key: string): Promise<number | null> {
    try {
      return await this.head(key);
    } catch {
      return null;
    }
  }
  sizeLimit(): number {
    return Number.MAX_SAFE_INTEGER;
  }

  private require(): FileStorage {
    if (!this.managed) throw new Error('unavailable');
    return this.managed;
  }
}
