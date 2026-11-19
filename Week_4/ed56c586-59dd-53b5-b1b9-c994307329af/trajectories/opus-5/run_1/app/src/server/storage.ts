/**
 * The object-store client: AWS Signature Version 4 over plain HTTP requests.
 * It stays on the server, and the browser never receives a store address.
 */

import { createHash, createHmac } from 'node:crypto';
import type { StorageConfig } from './config.js';

export class StorageUnreachableError extends Error {
  constructor(cause: unknown) {
    super('The media library could not be reached.');
    this.name = 'StorageUnreachableError';
    this.cause = cause;
  }
}

export interface StoredObject {
  readonly bytes: Buffer;
  readonly contentType: string;
}

const REQUEST_TIMEOUT_MS = 4000;

const sha256Hex = (payload: string | Buffer): string =>
  createHash('sha256').update(payload).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const amzDate = (now: Date): string =>
  `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;

export class ObjectStore {
  constructor(private readonly config: StorageConfig) {}

  private url(path: string): URL {
    const base = new URL(this.config.endpoint);
    base.pathname = path;
    return base;
  }

  private objectPath(key: string): string {
    const segments = key.split('/').map(encodeSegment);
    const prefix = this.config.forcePathStyle ? `/${encodeSegment(this.config.bucket)}` : '';
    return `${prefix}/${segments.join('/')}`;
  }

  private bucketPath(): string {
    return this.config.forcePathStyle ? `/${encodeSegment(this.config.bucket)}` : '/';
  }

  private async send(
    method: string,
    path: string,
    body: Buffer | undefined,
    extraHeaders: Record<string, string>,
  ): Promise<Response> {
    const url = this.url(path);
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = sha256Hex(payload);
    const now = new Date();
    const stamp = amzDate(now);
    const day = stamp.slice(0, 8);
    const scope = `${day}/${this.config.region}/s3/aws4_request`;

    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
      ...extraHeaders,
    };
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names
      .map((name) => `${name}:${(headers[name] ?? '').trim()}\n`)
      .join('');
    const signedHeaders = names.join(';');
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      stamp,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, day), this.config.region), 's3'),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    try {
      return await fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: new Uint8Array(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new StorageUnreachableError(cause);
    }
  }

  /** Resolves when storage answered at all, and throws when it cannot be reached. */
  async ping(): Promise<void> {
    await this.send('HEAD', this.bucketPath(), undefined, {});
  }

  async createBucketIfMissing(): Promise<void> {
    const head = await this.send('HEAD', this.bucketPath(), undefined, {});
    if (head.ok) return;
    if (head.status !== 404) {
      throw new StorageUnreachableError(new Error(`Bucket check failed: ${head.status}`));
    }
    const created = await this.send('PUT', this.bucketPath(), undefined, {});
    if (!created.ok && created.status !== 409) {
      throw new StorageUnreachableError(new Error(`Bucket create failed: ${created.status}`));
    }
  }

  async objectExists(key: string): Promise<boolean> {
    const response = await this.send('HEAD', this.objectPath(key), undefined, {});
    if (response.ok) return true;
    if (response.status === 404) return false;
    throw new StorageUnreachableError(new Error(`Object check failed: ${response.status}`));
  }

  async putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await this.send('PUT', this.objectPath(key), bytes, {
      'content-type': contentType,
    });
    if (!response.ok) {
      throw new StorageUnreachableError(new Error(`Object store failed: ${response.status}`));
    }
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const response = await this.send('GET', this.objectPath(key), undefined, {});
    if (response.status === 404) {
      await response.arrayBuffer();
      return null;
    }
    if (!response.ok) {
      throw new StorageUnreachableError(new Error(`Object read failed: ${response.status}`));
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (cause) {
      throw new StorageUnreachableError(cause);
    }
    return {
      bytes,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async deleteObject(key: string): Promise<void> {
    const response = await this.send('DELETE', this.objectPath(key), undefined, {});
    if (!response.ok && response.status !== 404) {
      throw new StorageUnreachableError(new Error(`Object delete failed: ${response.status}`));
    }
  }
}
