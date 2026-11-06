import { createHmac, createHash } from 'node:crypto';
import type { AppConfig } from './config.js';

/**
 * Minimal S3 client for the two operations this app needs (PutObject, GetObject,
 * HeadBucket) using AWS Signature V4. Nothing else is in scope.
 */

export interface S3Object { data: Buffer; contentType: string | null }

export class S3Client {
  private readonly style: boolean;
  constructor(private readonly cfg: AppConfig['s3']) {
    this.style = cfg.forcePathStyle;
  }

  private url(key: string): { url: URL; host: string } {
    const base = new URL(this.cfg.endpoint);
    if (this.style) {
      return {
        url: new URL(`${this.cfg.endpoint}/${this.cfg.bucket}/${key}`),
        host: base.host,
      };
    }
    const host = `${this.cfg.bucket}.${base.host}`;
    return {
      url: new URL(`${base.protocol}//${host}${base.pathname === '/' ? '' : base.pathname}/${key}`),
      host,
    };
  }

  private signingKey(date: string): Buffer {
    const kDate = createHmac('sha256', `AWS4${this.cfg.secretAccessKey}`).update(date).digest();
    const kRegion = createHmac('sha256', kDate).update(this.cfg.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    return createHmac('sha256', kService).update('aws4_request').digest();
  }

  private canonicalHeaders(headers: Record<string, string>): string {
    return Object.keys(headers)
      .sort()
      .map((k) => `${k}:${headers[k]!.trim()}\n`)
      .join('');
  }

  private signedHeaders(headers: Record<string, string>): string {
    return Object.keys(headers).sort().join(';');
  }

  private async request(
    method: string,
    key: string,
    body: Buffer,
    extraHeaders: Record<string, string>
  ): Promise<{ status: number; headers: Headers; body: Buffer }> {
    const { url, host } = this.url(key);
    url.search = '';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').replace(' ', 'T');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body).digest('hex');

    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const signed = this.signedHeaders(headers);
    const canonicalRequest = [
      method,
      this.style ? `/${this.cfg.bucket}/${key}` : `/${key}`,
      '',
      this.canonicalHeaders(headers),
      signed,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signature = createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex');
    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(5000),
    };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = new Uint8Array(body);
    }
    const response = await fetch(url, init);
    const responseBytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, body: responseBytes };
  }

  async headBucket(): Promise<boolean> {
    try {
      const { status } = await this.request('HEAD', '', Buffer.alloc(0), {});
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const { status, body } = await this.request('PUT', key, data, {
      'content-type': contentType,
      'content-length': String(data.length),
    });
    if (status >= 300) {
      throw new Error(`S3 put failed with ${status}: ${body.toString('utf8').slice(0, 200)}`);
    }
  }

  async get(key: string): Promise<S3Object | null> {
    const { status, headers, body } = await this.request('GET', key, Buffer.alloc(0), {});
    if (status === 404) return null;
    if (status >= 300) {
      throw new Error(`S3 get failed with ${status}: ${body.toString('utf8').slice(0, 200)}`);
    }
    return { data: body, contentType: headers.get('content-type') };
  }
}
