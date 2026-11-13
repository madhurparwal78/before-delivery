import crypto from 'node:crypto';

// MinIO S3 client over signed requests. Signature V4, path style when asked.
import type { S3Config } from './s3core.js';
import { s3Fetch } from './s3core.js';

export interface Storage {
  put(key: string, bytes: Buffer, contentType: string): Promise<boolean>;
  get(key: string): Promise<Buffer | null>;
  healthy(): Promise<boolean>;
}

class MinioStorage implements Storage {
  constructor(private readonly config: S3Config, private readonly down: () => boolean) {}

  private request(method: string, key: string, body: Buffer | null, contentType: string): Promise<Response> {
    if (this.down()) return Promise.reject(new Error('storage down'));
    return s3Fetch(this.config, method, key, body, contentType);
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<boolean> {
    await this.request('PUT', key, bytes, contentType);
    return true;
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.request('GET', key, null, '');
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  async healthy(): Promise<boolean> {
    const response = await this.request('GET', '', null, '');
    return response.ok || response.status === 403 || response.status === 404;
  }
}

let storageDown = false;

export function makeStorage(config: S3Config): Storage {
  return new MinioStorage(config, () => storageDown);
}

export function setStorageDown(down: boolean): void {
  storageDown = down;
}

export function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
