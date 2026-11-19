// Minimal S3 client for MinIO with AWS Signature V4; no SDK dependency.

import { createHmac, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:http';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3Object {
  bytes: number;
  sha256: string;
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export class S3 {
  constructor(private config: S3Config) {}

  private url(path: string, query: string): { url: URL; pathForSign: string } {
    const endpoint = new URL(this.config.endpoint);
    const isPathStyle = this.config.forcePathStyle || endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost';
    const bucketInPath = isPathStyle;
    const host = endpoint.host;
    const authority = bucketInPath ? host : `${this.config.bucket}.${host}`;
    const rawPath = bucketInPath ? `/${this.config.bucket}${path}` : `${path}`;
    const pathname = rawPath.split('/').map((segment, i) => (i === 0 ? segment : encodeURIComponent(segment))).join('/');
    const url = new URL(`${endpoint.protocol}//${authority}${pathname}${query ? `?${query}` : ''}`);
    return { url, pathForSign: `${pathname}${query ? `?${query}` : ''}` };
  }

  /** Signed request to S3. `payload` is the raw body; unsigned payload for streaming replies. */
  private call(method: string, path: string, query: string, payload: Buffer | null, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
    const { url, pathForSign } = this.url(path, query);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = payload === null ? 'UNSIGNED-PAYLOAD' : sha256Hex(payload);
    const allHeaders: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    if (payload !== null) allHeaders['content-length'] = String(payload.length);
    const sortedKeys = Object.keys(allHeaders).sort();
    const canonicalHeaders = sortedKeys.map((key) => `${key}:${allHeaders[key].trim()}\n`).join('');
    const signedHeaders = sortedKeys.join(';');
    const canonicalRequest = [method, pathForSign, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, dateStamp), this.config.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return new Promise((resolve, reject) => {
      const options: RequestOptions = {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: { ...allHeaders, authorization },
      };
      const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = requester(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      });
      req.on('error', reject);
      req.setTimeout(8000, () => {
        req.destroy(new Error('s3_timeout'));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<S3Object> {
    const result = await this.call('PUT', `/${key}`, '', data, { 'content-type': contentType });
    if (result.status !== 200) throw new Error(`s3_put_failed_${result.status}`);
    return { bytes: data.length, sha256: sha256Hex(data) };
  }

  async get(key: string): Promise<Buffer | null> {
    const result = await this.call('GET', `/${key}`, '', null);
    if (result.status === 200) return result.body;
    if (result.status === 404) return null;
    throw new Error(`s3_get_failed_${result.status}`);
  }

  async head(key: string): Promise<S3Object | null> {
    const path = key === '/' ? '/' : `/${key}`;
    const result = await this.call('HEAD', path, '', null);
    if (result.status !== 200) return null;
    if (key === '/') return { bytes: 0, sha256: '' };
    const length = Number(result.headers['content-length'] ?? 0);
    const etag = String(result.headers.etag ?? '').replace(/"/g, '');
    return { bytes: length, sha256: etag };
  }

  async ensureBucket(): Promise<void> {
    // Path-style bucket creation: only when it does not answer yet.
    const existing = await this.call('HEAD', '/', '', null);
    if (existing.status === 200) return;
    const result = await this.call('PUT', '/', '', Buffer.alloc(0));
    if (result.status !== 200 && result.status !== 409) throw new Error(`s3_bucket_failed_${result.status}`);
  }

  /** Probes the storage by putting and removing a tiny probe object. */
  async ping(): Promise<boolean> {
    try {
      await this.call('PUT', '/healthcheck-probe', '', Buffer.alloc(0), { 'content-type': 'application/octet-stream' });
      await this.call('DELETE', '/healthcheck-probe', '', null);
      return true;
    } catch {
      return false;
    }
  }

  /** Only used by seeding to check an object exists; listings are never offered. */
  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }
}

export { EMPTY_SHA256 };
