import crypto from 'node:crypto';
import type { Config } from './config.js';

/** Minimal S3 client for the two object shapes the app stores. */

interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  creds: AwsCreds;
}

export class Storage {
  private cfg: StorageConfig;
  constructor(cfg: Config['s3']) {
    this.cfg = {
      endpoint: cfg.endpoint.replace(/\/$/, ''),
      region: cfg.region,
      bucket: cfg.bucket,
      forcePathStyle: cfg.forcePathStyle,
      creds: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    };
  }

  private urlFor(key: string): URL {
    const { endpoint, bucket, forcePathStyle } = this.cfg;
    if (forcePathStyle) {
      return new URL(`${endpoint}/${bucket}/${key}`);
    }
    const u = new URL(endpoint);
    return new URL(`${u.protocol}//${bucket}.${u.host}/${key}`);
  }

  private sign(method: string, url: URL, payload: Buffer, extraHeaders: Record<string, string> = {}): { headers: Record<string, string>; body: Buffer } {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(payload);
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const signedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${(headers as Record<string,string>)[h]}\n`).join('');
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const kDate = hmac(`AWS4${this.cfg.creds.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
    const auth = `AWS4-HMAC-SHA256 Credential=${this.cfg.creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return {
      headers: { ...headers, Authorization: auth },
      body: payload,
    };
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const url = this.urlFor(key);
    const { headers, body } = this.sign('PUT', url, data, { 'content-type': contentType });
    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });
    if (!res.ok) throw new Error(`storage put failed: ${res.status}`);
  }

  async get(key: string): Promise<Buffer | null> {
    const url = this.urlFor(key);
    const { headers } = this.sign('GET', url, Buffer.alloc(0));
    const res = await fetch(url, { method: 'GET', headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`storage get failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async head(key: string): Promise<{ exists: boolean; size: number | null }> {
    const url = this.urlFor(key);
    const { headers } = this.sign('HEAD', url, Buffer.alloc(0));
    const res = await fetch(url, { method: 'HEAD', headers });
    if (res.status === 404) return { exists: false, size: null };
    if (!res.ok) throw new Error(`storage head failed: ${res.status}`);
    const len = res.headers.get('content-length');
    return { exists: true, size: len === null ? null : Number.parseInt(len, 10) };
  }

  async delete(key: string): Promise<void> {
    const url = this.urlFor(key);
    const { headers } = this.sign('DELETE', url, Buffer.alloc(0));
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) throw new Error(`storage delete failed: ${res.status}`);
  }
}
