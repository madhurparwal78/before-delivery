/** MinIO object storage for the picture sheets, signed with AWS SigV4. */

import { createHash, createHmac } from 'node:crypto';
import type { S3Config } from './config.js';

const GIVE_UP_MS = 5000;
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export class StorageUnreachable extends Error {
  constructor(reason: string) {
    super(`storage unreachable: ${reason}`);
    this.name = 'StorageUnreachable';
  }
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export class SheetStore {
  constructor(private readonly config: S3Config) {}

  /** `sheets/night-4/round-<n>/<sha256>.<ext>` */
  sheetKey(night: number, round: number, sha256: string, extension: 'png' | 'jpg'): string {
    return `sheets/night-${night}/round-${round}/${sha256}.${extension}`;
  }

  async ensureBucket(): Promise<void> {
    const head = await this.call('HEAD', '', undefined, undefined);
    if (head.status === 200) return;
    if (head.status === 404) {
      const made = await this.call('PUT', '', Buffer.alloc(0), undefined);
      if (made.status !== 200 && made.status !== 409) {
        throw new StorageUnreachable(`bucket not created (${made.status})`);
      }
      return;
    }
    throw new StorageUnreachable(`bucket not reachable (${head.status})`);
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await this.call('PUT', key, bytes, contentType);
    if (response.status !== 200) throw new StorageUnreachable(`put failed (${response.status})`);
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.call('GET', key, undefined, undefined);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new StorageUnreachable(`get failed (${response.status})`);
    return {
      bytes: response.bytes,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  /** Storage's own report of an object: its size and the SHA-256 of its bytes. */
  async confirm(key: string): Promise<{ size: number; sha256: string } | null> {
    const object = await this.get(key);
    if (object === null) return null;
    return { size: object.bytes.byteLength, sha256: createHash('sha256').update(object.bytes).digest('hex') };
  }

  async size(key: string): Promise<number | null> {
    const response = await this.call('HEAD', key, undefined, undefined);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new StorageUnreachable(`head failed (${response.status})`);
    const length = response.headers.get('content-length');
    if (length === null) throw new StorageUnreachable('head without content-length');
    return Number(length);
  }

  private async call(
    method: 'GET' | 'PUT' | 'HEAD',
    key: string,
    body: Buffer | undefined,
    contentType: string | undefined,
  ): Promise<{ status: number; bytes: Buffer; headers: Headers }> {
    const base = new URL(this.config.endpoint);
    const path = this.config.forcePathStyle
      ? `/${this.config.bucket}${key === '' ? '' : `/${key.split('/').map(encodeSegment).join('/')}`}`
      : `/${key.split('/').map(encodeSegment).join('/')}`;
    const url = new URL(path, base);
    const payloadHash = body === undefined ? EMPTY_SHA256 : createHash('sha256').update(body).digest('hex');
    const now = new Date();
    const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    const stamp = amzDate.slice(0, 8);

    const headers = new Map<string, string>();
    headers.set('host', url.host);
    headers.set('x-amz-content-sha256', payloadHash);
    headers.set('x-amz-date', amzDate);
    if (contentType !== undefined) headers.set('content-type', contentType);

    const signedHeaders = [...headers.keys()].sort();
    const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers.get(name)}\n`).join('');
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders.join(';'),
      payloadHash,
    ].join('\n');
    const scope = `${stamp}/${this.config.region}/s3/aws4_request`;
    const toSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, stamp), this.config.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(toSign, 'utf8').digest('hex');

    const requestHeaders: Record<string, string> = {};
    for (const [name, value] of headers) requestHeaders[name] = value;
    delete requestHeaders['host'];
    requestHeaders['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body === undefined || method === 'HEAD' ? undefined : new Uint8Array(body),
        signal: AbortSignal.timeout(GIVE_UP_MS),
      });
      const bytes =
        method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(new Uint8Array(await response.arrayBuffer()));
      return { status: response.status, bytes, headers: response.headers };
    } catch (reason) {
      throw new StorageUnreachable(reason instanceof Error ? reason.message : 'unknown');
    }
  }
}
