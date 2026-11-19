import { createHash, createHmac } from 'node:crypto';
import type { AppConfig } from './config.js';

export interface Storage {
  put(key: string, content: string): Promise<void>;
  get(key: string): Promise<string>;
  putZip(key: string, bytes: Uint8Array): Promise<void>;
  healthy(): Promise<boolean>;
}

export const STORAGE_OUTAGE_PUSH = 'Storage is unavailable. Nothing was saved. Try again in a moment.';
export const STORAGE_OUTAGE_ARCHIVE = 'Storage is unavailable. The archive was not exported. Try again in a moment.';

export function contentKey(content: string): string {
  return `objects/${createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')}`;
}

function hmac(key: Buffer | string, data: string | Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Minimal S3 client with SigV4 over fetch, path-style addressing. Every byte
 * is stored exactly as submitted and read back exactly as stored.
 */
export class S3Storage implements Storage {
  private cfg: AppConfig;

  constructor(cfg: AppConfig) { this.cfg = cfg; }

  private objectUrl(key: string): string {
    const base = this.cfg.s3Endpoint.replace(/\/+$/, '');
    return `${base}/${this.cfg.s3Bucket}/${key.split('/').map(uriEncode).join('/')}`;
  }

  private async request(method: string, key: string, body: Buffer): Promise<Response> {
    const url = this.objectUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body);
    const host = new URL(url).host;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      `/${this.cfg.s3Bucket}/${key.split('/').map(uriEncode).join('/')}`,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.cfg.s3Region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(Buffer.from(canonicalRequest, 'utf8'))].join('\n');
    const kDate = hmac(`AWS4${this.cfg.s3SecretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.s3Region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.cfg.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
      },
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
    });
  }

  async put(key: string, content: string): Promise<void> {
    const res = await this.request('PUT', key, Buffer.from(content, 'utf8'));
    if (!res.ok) throw new Error(`S3 put failed: ${res.status}`);
  }

  async get(key: string): Promise<string> {
    const res = await this.request('GET', key, Buffer.alloc(0));
    if (!res.ok) throw new Error(`S3 get failed: ${res.status}`);
    return await res.text();
  }

  async putZip(key: string, bytes: Uint8Array): Promise<void> {
    const res = await this.request('PUT', key, Buffer.from(bytes));
    if (!res.ok) throw new Error(`S3 put failed: ${res.status}`);
  }

  async healthy(): Promise<boolean> {
    try {
      const key = `objects/.healthcheck-${Date.now()}`;
      const res = await this.request('PUT', key, Buffer.alloc(0));
      return res.ok;
    } catch {
      return false;
    }
  }
}
