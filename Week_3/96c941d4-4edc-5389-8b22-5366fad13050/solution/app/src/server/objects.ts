import { createHash, createHmac } from 'node:crypto';
import type { ObjectStoreConfig } from './config.js';

export class ObjectStoreError extends Error {}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 1200;

function sha256Hex(payload: Uint8Array | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export class ObjectStore {
  private readonly base: URL;

  constructor(private readonly config: ObjectStoreConfig) {
    this.base = new URL(config.endpoint);
  }

  private url(key: string): URL {
    const url = new URL(this.base.toString());
    if (this.config.forcePathStyle) {
      url.pathname = `/${this.config.bucket}/${encodePath(key)}`;
    } else {
      url.hostname = `${this.config.bucket}.${url.hostname}`;
      url.pathname = `/${encodePath(key)}`;
    }
    return url;
  }

  private signedHeaders(method: string, url: URL, payload: Uint8Array): Record<string, string> {
    const { stamp, date } = amzDate(new Date());
    const payloadHash = sha256Hex(payload);
    const host = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`;
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaderNames.join(';'),
      payloadHash,
    ].join('\n');
    const scope = `${date}/${this.config.region}/${SERVICE}/aws4_request`;
    const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
    const dateKey = hmac(`AWS4${this.config.secretAccessKey}`, date);
    const regionKey = hmac(dateKey, this.config.region);
    const serviceKey = hmac(regionKey, SERVICE);
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    return {
      ...headers,
      authorization: `${ALGORITHM} Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`,
    };
  }

  private async send(method: string, key: string, payload: Uint8Array): Promise<Response> {
    const url = this.url(key);
    const headers = this.signedHeaders(method, url, payload);
    try {
      return await fetch(url, {
        method,
        headers: method === 'PUT' ? { ...headers, 'content-type': 'application/json', 'if-none-match': '*' } : headers,
        body: method === 'PUT' ? payload : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ObjectStoreError(`object store request failed: ${(error as Error).message}`);
    }
  }

  /** Writes immutable bytes, leaving an existing key untouched. */
  async putImmutable(key: string, payload: Uint8Array): Promise<void> {
    const head = await this.send('HEAD', key, new Uint8Array());
    if (head.status === 200) return;
    if (head.status !== 404) throw new ObjectStoreError(`unexpected head status ${head.status}`);
    const response = await this.send('PUT', key, payload);
    if (response.status !== 200 && response.status !== 412) {
      throw new ObjectStoreError(`unexpected put status ${response.status}`);
    }
  }

  /** Reads confirmed object bytes, or null when the key is absent. */
  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.send('GET', key, new Uint8Array());
    if (response.status === 404) return null;
    if (response.status !== 200) throw new ObjectStoreError(`unexpected get status ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export function levelObjectKey(levelDigest: string): string {
  return `levels/${levelDigest}.json`;
}

export function evidenceObjectKey(evidenceDigest: string): string {
  return `evidence/${evidenceDigest}.json`;
}
