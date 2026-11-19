import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

export class StorageError extends Error {}

interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function sign(method: string, objectKey: string | null, body: Buffer, query: string): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${objectKey === null ? '' : `/${encodeKeyPath(objectKey)}`}`
    : `${objectKey === null ? '/' : `/${encodeKeyPath(objectKey)}`}`;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'), 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const base = config.s3.forcePathStyle ? `${endpoint.protocol}//${endpoint.host}` : `${endpoint.protocol}//${host}`;
  return {
    url: `${base}${path}${query === '' ? '' : `?${query}`}`,
    method,
    headers,
    ...(method === 'PUT' ? { body } : {})
  };
}

class ObjectStore {
  private forcedDown = false;

  setForcedDown(down: boolean): void {
    this.forcedDown = down;
  }

  private async send(
    method: string,
    objectKey: string | null,
    body: Buffer,
    query = '',
    extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    if (this.forcedDown) throw new StorageError('object store marked down');
    const signed = sign(method, objectKey, body, query);
    let response: Response;
    try {
      response = await fetch(signed.url, {
        method: signed.method,
        headers: { ...signed.headers, ...extraHeaders },
        ...(signed.body === undefined ? {} : { body: new Uint8Array(signed.body) }),
        signal: AbortSignal.timeout(5_000)
      });
    } catch (error) {
      throw new StorageError(`object store unreachable: ${String(error)}`);
    }
    if (response.status >= 500) {
      throw new StorageError(`object store answered ${response.status}`);
    }
    return response;
  }

  async put(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.send('PUT', objectKey, body, '', { 'content-type': contentType });
    if (!response.ok) throw new StorageError(`put ${objectKey} answered ${response.status}`);
    await response.arrayBuffer();
  }

  /** DP-16: a file counts only once the store confirms the object's byte count. */
  async confirm(objectKey: string, bytes: number): Promise<boolean> {
    const response = await this.send('HEAD', objectKey, Buffer.alloc(0));
    if (!response.ok) return false;
    return Number(response.headers.get('content-length') ?? '-1') === bytes;
  }

  async get(objectKey: string): Promise<Buffer | null> {
    const response = await this.send('GET', objectKey, Buffer.alloc(0));
    if (response.status === 404) return null;
    if (!response.ok) throw new StorageError(`get ${objectKey} answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(objectKey: string): Promise<void> {
    const response = await this.send('DELETE', objectKey, Buffer.alloc(0));
    await response.arrayBuffer();
  }

  async ensureBucket(): Promise<void> {
    const head = await this.send('HEAD', null, Buffer.alloc(0));
    if (head.ok) return;
    const created = await this.send('PUT', null, Buffer.alloc(0));
    await created.arrayBuffer();
  }

  async available(): Promise<boolean> {
    if (this.forcedDown) return false;
    try {
      const response = await this.send('HEAD', null, Buffer.alloc(0));
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const store = new ObjectStore();

export function objectKeyFor(lessonId: string, fileId: string): string {
  return `lessons/${lessonId}/${fileId}`;
}
