/**
 * A small S3 client for the filing vault, signing requests with AWS SigV4.
 * Nothing it throws ever carries the vault's address or the underlying failure.
 */
import { createHash, createHmac } from 'node:crypto';
import { VaultConfig } from './config';

export class VaultUnreachable extends Error {
  constructor() {
    super('vault unreachable');
    this.name = 'VaultUnreachable';
  }
}

export interface VaultResponse {
  status: number;
  body: Buffer;
  headers: Headers;
}

const UNRESERVED = /[A-Za-z0-9\-._~]/;

function encodeSegment(segment: string): string {
  let encoded = '';
  for (const character of segment) {
    if (UNRESERVED.test(character)) {
      encoded += character;
    } else {
      for (const byte of Buffer.from(character, 'utf8')) {
        encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return encoded;
}

function canonicalUri(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeSegment(segment))
    .join('/');
}

function amzDate(now: Date): { stamp: string; day: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp: iso, day: iso.slice(0, 8) };
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export class VaultClient {
  private readonly endpoint: URL;

  constructor(private readonly config: VaultConfig) {
    this.endpoint = new URL(config.endpoint);
  }

  private pathFor(key: string | null): string {
    const bucketPath = this.config.forcePathStyle ? `/${this.config.bucket}` : '';
    if (key === null) return bucketPath === '' ? '/' : bucketPath;
    return `${bucketPath}/${key}`;
  }

  private sign(
    method: string,
    path: string,
    queryString: string,
    headers: Record<string, string>,
    payloadHash: string,
    now: Date,
  ): Record<string, string> {
    const { stamp, day } = amzDate(now);
    const host = this.endpoint.host;
    const signedHeaders: Record<string, string> = {
      ...headers,
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
    };
    const names = Object.keys(signedHeaders)
      .map((name) => name.toLowerCase())
      .sort();
    const lowered = new Map(
      Object.entries(signedHeaders).map(([name, value]) => [name.toLowerCase(), value.trim()]),
    );
    const canonicalHeaders = names.map((name) => `${name}:${lowered.get(name) ?? ''}\n`).join('');
    const signedHeaderList = names.join(';');
    const canonicalRequest = [
      method,
      canonicalUri(path),
      queryString,
      canonicalHeaders,
      signedHeaderList,
      payloadHash,
    ].join('\n');
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      stamp,
      scope,
      createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
    ].join('\n');
    const dateKey = hmac(Buffer.from(`AWS4${this.config.secretAccessKey}`, 'utf8'), day);
    const regionKey = hmac(dateKey, this.config.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    return {
      ...signedHeaders,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaderList}, Signature=${signature}`,
    };
  }

  private async send(
    method: string,
    key: string | null,
    options: { body?: Buffer; headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<VaultResponse> {
    const path = this.pathFor(key);
    const body = options.body ?? Buffer.alloc(0);
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const headers = this.sign(
      method,
      path,
      '',
      options.headers ?? {},
      payloadHash,
      new Date(),
    );
    const url = new URL(path, this.endpoint);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
      });
      const received = Buffer.from(await response.arrayBuffer());
      return { status: response.status, body: received, headers: response.headers };
    } catch {
      throw new VaultUnreachable();
    }
  }

  async probe(): Promise<boolean> {
    try {
      const response = await this.send('HEAD', null, { timeoutMs: 3000 });
      return response.status < 500;
    } catch {
      return false;
    }
  }

  async ensureBucket(): Promise<void> {
    const head = await this.send('HEAD', null, { timeoutMs: 4000 });
    if (head.status === 404) {
      const created = await this.send('PUT', null, { timeoutMs: 6000 });
      if (created.status >= 300 && created.status !== 409) throw new VaultUnreachable();
    } else if (head.status >= 500) {
      throw new VaultUnreachable();
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.send('PUT', key, {
      body,
      headers: { 'content-type': contentType },
      timeoutMs: 15000,
    });
    if (response.status >= 300) throw new VaultUnreachable();
  }

  /**
   * Create-only write of the published exhibit key. Returns false when the key
   * already holds an object, which is then attached unchanged.
   */
  async putObjectIfAbsent(key: string, body: Buffer, contentType: string): Promise<boolean> {
    const response = await this.send('PUT', key, {
      body,
      headers: { 'content-type': contentType, 'if-none-match': '*' },
      timeoutMs: 15000,
    });
    if (response.status === 412 || response.status === 304 || response.status === 409) return false;
    if (response.status >= 300) throw new VaultUnreachable();
    return true;
  }

  async getObject(key: string): Promise<Buffer | null> {
    const response = await this.send('GET', key, { timeoutMs: 15000 });
    if (response.status === 404) return null;
    if (response.status >= 300) throw new VaultUnreachable();
    return response.body;
  }

  async objectExists(key: string): Promise<boolean> {
    const response = await this.send('HEAD', key, { timeoutMs: 6000 });
    if (response.status === 404) return false;
    if (response.status >= 300) throw new VaultUnreachable();
    return true;
  }
}
