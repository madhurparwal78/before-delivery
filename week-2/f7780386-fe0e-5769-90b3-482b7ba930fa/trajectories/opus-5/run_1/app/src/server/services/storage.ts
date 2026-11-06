import { createHash, createHmac } from 'node:crypto';

import type { StorageConfig } from '../config.js';

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('storage_unavailable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

const UNSIGNED_PAYLOAD_ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 8000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986 encoding, with `/` preserved for object keys. */
function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * A signed S3 client for the provided MinIO bucket. Request signatures carry
 * the real wall clock, which the object store validates for skew; it is never
 * used for a business decision.
 */
export class ObjectStorage {
  readonly #config: StorageConfig;

  constructor(config: StorageConfig) {
    this.#config = config;
  }

  #url(key: string): URL {
    const encoded = encodeKeyPath(key);
    if (this.#config.forcePathStyle) {
      return new URL(`${this.#config.endpoint}/${this.#config.bucket}/${encoded}`);
    }
    const base = new URL(this.#config.endpoint);
    base.hostname = `${this.#config.bucket}.${base.hostname}`;
    base.pathname = `/${encoded}`;
    return base;
  }

  #sign(method: string, url: URL, headers: Record<string, string>, payloadHash: string): void {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const date = stamp.slice(0, 8);
    headers['host'] = url.host;
    headers['x-amz-date'] = stamp;
    headers['x-amz-content-sha256'] = payloadHash;

    const signedHeaderNames = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${String(headers[name]).trim()}\n`)
      .join('');
    const signedHeaders = signedHeaderNames.join(';');

    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${date}/${this.#config.region}/s3/aws4_request`;
    const stringToSign = [
      UNSIGNED_PAYLOAD_ALGORITHM,
      stamp,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.#config.secretAccessKey}`, date), this.#config.region), 's3'),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    headers['authorization'] =
      `${UNSIGNED_PAYLOAD_ALGORITHM} Credential=${this.#config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  async #send(
    method: string,
    key: string,
    body: Buffer | null,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const url = this.#url(key);
    const headers: Record<string, string> = { ...extraHeaders };
    const payload = body ?? Buffer.alloc(0);
    this.#sign(method, url, headers, sha256Hex(payload));
    try {
      return await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new StorageUnavailable(error);
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.#send('PUT', key, body, {
      'content-type': contentType,
      'content-length': String(body.byteLength),
    });
    if (!response.ok) {
      throw new StorageUnavailable(new Error(`PUT ${key} answered ${response.status}`));
    }
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const response = await this.#send('GET', key, null);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new StorageUnavailable(new Error(`GET ${key} answered ${response.status}`));
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async objectExists(key: string): Promise<boolean> {
    const response = await this.#send('HEAD', key, null);
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new StorageUnavailable(new Error(`HEAD ${key} answered ${response.status}`));
    }
    return true;
  }

  /** Cheap reachability probe used by the background retry loops. */
  async isReachable(): Promise<boolean> {
    try {
      await this.objectExists('passboard/.probe');
      return true;
    } catch {
      return false;
    }
  }
}
