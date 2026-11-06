import { createHash, createHmac } from 'node:crypto';
import { DEPENDENCY_TIMEOUT_MS } from '../config.js';
import type { Config } from '../config.js';

/** Raised when the photo bucket cannot be reached; it carries no provider detail. */
export class PhotoStorageUnavailable extends Error {
  constructor() {
    super('photo storage unavailable');
    this.name = 'PhotoStorageUnavailable';
  }
}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

export class ObjectStore {
  private readonly config: Config['s3'];

  constructor(config: Config['s3']) {
    this.config = config;
  }

  private sign(method: string, path: string, body: Buffer, extraHeaders: Record<string, string>): SignedRequest {
    const endpoint = new URL(this.config.endpoint);
    const url = `${endpoint.origin}${path}`;
    const amzDate = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    const shortDate = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = { host: endpoint.host };
    for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
    headers['x-amz-content-sha256'] = payloadHash;
    headers['x-amz-date'] = amzDate;
    const sortedNames = Object.keys(headers).sort();
    const canonicalHeaders = sortedNames
      .map((name) => `${name}:${(headers[name] as string).trim()}\n`)
      .join('');
    const signedHeaders = sortedNames.join(';');
    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${shortDate}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const dateKey = hmac(Buffer.from(`AWS4${this.config.secretAccessKey}`, 'utf8'), shortDate);
    const regionKey = hmac(dateKey, this.config.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = hmac(signingKey, stringToSign).toString('hex');
    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { url, headers };
  }

  private async send(
    method: string,
    path: string,
    body: Buffer,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const signed = this.sign(method, path, body, extraHeaders);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEPENDENCY_TIMEOUT_MS);
    try {
      const request: RequestInit = { method, headers: signed.headers, signal: controller.signal };
      if (method !== 'GET' && method !== 'HEAD') request.body = body;
      return await fetch(signed.url, request);
    } catch {
      throw new PhotoStorageUnavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  private objectPath(key: string): string {
    const encodedKey = key.split('/').map(encodeSegment).join('/');
    return `/${encodeSegment(this.config.bucket)}/${encodedKey}`;
  }

  async ensureBucket(): Promise<void> {
    const head = await this.send('HEAD', `/${encodeSegment(this.config.bucket)}`, Buffer.alloc(0));
    if (head.ok) return;
    await this.send('PUT', `/${encodeSegment(this.config.bucket)}`, Buffer.alloc(0));
  }

  async probe(): Promise<boolean> {
    try {
      const response = await this.send('HEAD', `/${encodeSegment(this.config.bucket)}`, Buffer.alloc(0));
      return response.ok;
    } catch {
      return false;
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.send('PUT', this.objectPath(key), body, {
      'content-type': contentType,
    });
    if (!response.ok) throw new PhotoStorageUnavailable();
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.send('GET', this.objectPath(key), Buffer.alloc(0));
    if (!response.ok) throw new PhotoStorageUnavailable();
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    try {
      await this.send('DELETE', this.objectPath(key), Buffer.alloc(0));
    } catch {
      /* the object was never written, or the bucket is down and holds no record of it */
    }
  }
}

export function photoKey(loanId: string, stage: string, photoId: string, extension: string): string {
  return `loans/${loanId}/${stage}/${photoId}.${extension}`;
}
