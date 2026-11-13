import crypto from 'node:crypto';
import type { Config } from '../config.js';

/** Minimal SigV4 client for the one bucket we use. */
export class ObjectStore {
  constructor(private cfg: Config) {}

  private host(): string {
    return new URL(this.cfg.s3Endpoint).host;
  }

  private async headers(method: string, key: string, payload: Buffer | Uint8Array | string, extra?: Record<string, string>): Promise<Record<string, string>> {
    const url = new URL(this.cfg.s3Endpoint);
    const host = url.host;
    const canonicalUri = `/${this.cfg.s3Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
    const allHeaders: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extra,
    };
    const headerNames = Object.keys(allHeaders).sort();
    const canonicalHeaders = headerNames.map((h) => `${h}:${allHeaders[h] ?? ''}\n`).join('');
    const signedHeaders = headerNames.join(';');
    let canonicalQuery = '';
    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.cfg.s3Region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = hmac(`AWS4${this.cfg.s3SecretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.s3Region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    return {
      ...allHeaders,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.cfg.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  async available(): Promise<boolean> {
    // A signed stat against the bucket doubles as the reachability probe.
    try {
      const key = `healthcheck-${Date.now()}`;
      const headers = await this.headers('HEAD', key, '');
      const url = new URL(this.cfg.s3Endpoint);
      const res = await fetch(`${this.cfg.s3Endpoint}/${this.cfg.s3Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'HEAD',
        headers: { ...headers, host: url.host },
        signal: AbortSignal.timeout(3000),
      });
      return res.status !== 403 && res.status !== 404 || res.status === 404;
    } catch {
      return false;
    }
  }

  async ensureBucket(): Promise<void> {
    // The seeded bucket already exists; this only creates it when missing.
    const key = 'spindrift-bucket-probe';
    try {
      await this.put(key, Buffer.from('spindrift'), 'text/plain');
    } catch {
      const headers = await this.headers('PUT', '', '');
      const url = new URL(this.cfg.s3Endpoint);
      const res = await fetch(`${this.cfg.s3Endpoint}/${this.cfg.s3Bucket}`, {
        method: 'PUT',
        headers: { ...headers, host: url.host },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok && res.status !== 409) throw new Error(`bucket unavailable ${res.status}`);
    }
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const url = new URL(this.cfg.s3Endpoint);
    const headers = await this.headers('PUT', key, bytes, { 'content-type': contentType });
    const res = await fetch(`${this.cfg.s3Endpoint}/${this.cfg.s3Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      headers: { ...headers, host: url.host },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`s3 put failed ${res.status}`);
    // Confirm the object's size before reporting Stored.
    const stat = await this.stat(key);
    if (stat !== bytes.length) throw new Error('s3 size mismatch');
  }

  async stat(key: string): Promise<number | null> {
    const url = new URL(this.cfg.s3Endpoint);
    const headers = await this.headers('HEAD', key, '');
    const res = await fetch(`${this.cfg.s3Endpoint}/${this.cfg.s3Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'HEAD',
      headers: { ...headers, host: url.host },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const len = res.headers.get('content-length');
    return len ? Number(len) : null;
  }

  async get(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const url = new URL(this.cfg.s3Endpoint);
    const headers = await this.headers('GET', key, '');
    const res = await fetch(`${this.cfg.s3Endpoint}/${this.cfg.s3Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'GET',
      headers: { ...headers, host: url.host },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }
}

function hmac(key: crypto.BinaryLike | Uint8Array, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
