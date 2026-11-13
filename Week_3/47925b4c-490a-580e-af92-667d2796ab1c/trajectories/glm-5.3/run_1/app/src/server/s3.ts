// S3-compatible storage client speaking AWS SigV4 over HTTP with Node's own fetch.
// Works against MinIO with path-style addressing; no SDK dependency.

import { createHmac, createHash } from 'node:crypto';

export interface S3Options {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3UnavailableError extends Error {
  override readonly name = 'S3UnavailableError';
}

export class S3 {
  private readonly host: string;
  private readonly base: string;
  private readonly options: S3Options;

  constructor(options: S3Options) {
    this.options = options;
    const url = new URL(options.endpoint);
    this.host = url.host;
    if (options.forcePathStyle) {
      this.base = `${url.protocol}//${url.host}/${options.bucket}`;
    } else {
      const protocol = url.protocol;
      this.base = `${protocol}//${options.bucket}.${url.host}`;
    }
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const request = await this.request('PUT', key, bytes, { 'Content-Type': contentType });
    if (!request.ok) throw new S3UnavailableError(`put ${key} failed`);
  }

  async get(key: string): Promise<Buffer | null> {
    const request = await this.request('GET', key, null, {});
    if (request.status === 404) return null;
    if (!request.ok) throw new S3UnavailableError(`get ${key} failed`);
    return Buffer.from(await request.arrayBuffer());
  }

  async head(key: string): Promise<{ size: number } | null> {
    const request = await this.request('HEAD', key, null, {});
    if (request.status === 404) return null;
    if (!request.ok) throw new S3UnavailableError(`head ${key} failed`);
    return { size: Number(request.headers.get('content-length') ?? '0') };
  }

  private async request(
    method: string,
    key: string,
    body: Buffer | null,
    headers: Record<string, string>,
  ): Promise<Response> {
    const url = new URL(`${this.base}/${key}`);
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
    const host = url.host;
    const signedHeaders: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    const sortedKeys = Object.keys(signedHeaders).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${signedHeaders[k]}\n`).join('');
    const signedHeaderList = sortedKeys.join(';');
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaderList,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.options.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.options.secretAccessKey}`, dateStamp), this.options.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const request: RequestInit = {
        method,
        headers: {
          Authorization: authorization,
          ...signedHeaders,
        },
        signal: controller.signal,
      };
      if (body !== null) request.body = new Uint8Array(body);
      const response = await fetch(url, request);
      return response;
    } catch (err) {
      if (err instanceof S3UnavailableError) throw err;
      throw new S3UnavailableError(`request to ${this.host} failed`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
