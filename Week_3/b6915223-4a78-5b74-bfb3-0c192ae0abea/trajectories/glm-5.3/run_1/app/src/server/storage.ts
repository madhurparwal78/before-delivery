import * as crypto from 'node:crypto';
import type { Config } from './config';
import { ApiError } from './errors';

export interface S3ObjectMeta {
  key: string;
  size: number;
}

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export class StorageUnavailable extends ApiError {
  constructor() {
    super(503, 'storage_unavailable', 'Storage is unreachable right now.');
  }
}

export class StorageObjectMissing extends ApiError {
  constructor() {
    super(404, 'not_found', 'Nothing lives at this address.');
  }
}

export class StorageClient {
  private readonly config: Config;
  private readonly endpointUrl: URL;

  constructor(config: Config) {
    this.config = config;
    this.endpointUrl = new URL(config.s3.endpoint);
  }

  async createBucketIfMissing(): Promise<void> {
    await this.send('PUT', `/${this.config.s3.bucket}`, '', [200, 409]);
  }

  async put(key: string, body: string): Promise<void> {
    await this.send('PUT', `/${this.config.s3.bucket}/${key}`, body, [200, 201]);
  }

  async get(key: string): Promise<string> {
    return this.send('GET', `/${this.config.s3.bucket}/${key}`, undefined, [200]);
  }

  async list(prefix: string): Promise<S3ObjectMeta[]> {
    const query = `list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix)}`;
    const body = await this.send('GET', `/${this.config.s3.bucket}?${query}`, undefined, [200]);
    if (body.trim() === '') return [];
    const results: S3ObjectMeta[] = [];
    for (const chunk of body.split(/<Contents>/).slice(1)) {
      const key = /<Key>([^<]+)<\/Key>/.exec(chunk)?.[1];
      const size = /<Size>(\d+)<\/Size>/.exec(chunk)?.[1];
      if (key === undefined || size === undefined) continue;
      results.push({ key, size: Number(size) });
    }
    return results;
  }

  private async send(
    method: string,
    pathWithQuery: string,
    body: string | undefined,
    acceptedStatuses: number[],
  ): Promise<string> {
    const url = new URL(`${this.endpointUrl.protocol}//${this.endpointUrl.host}${pathWithQuery}`);
    const headers = new Map<string, string>();
    headers.set('x-amz-content-sha256', UNSIGNED_PAYLOAD);
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    headers.set('x-amz-date', amzDate);
    headers.set('host', url.host);
    if (body !== undefined) headers.set('content-length', String(Buffer.byteLength(body)));
    headers.set('authorization', this.authorization(method, url, headers));
    headers.delete('host');
    headers.delete('content-length');

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: Array.from(headers.entries()),
        body,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new StorageUnavailable();
    }
    if (acceptedStatuses.includes(response.status)) {
      return await response.text();
    }
    await response.text();
    if (response.status === 404) throw new StorageObjectMissing();
    throw new StorageUnavailable();
  }

  private authorization(method: string, url: URL, headers: Map<string, string>): string {
    const signed = Array.from(headers.entries())
      .map(([key, value]) => [key.toLowerCase(), value] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const canonicalHeaders = signed.map(([key, value]) => `${key}:${value}\n`).join('');
    const headerNames = signed.map(([key]) => key).join(';');
    const canonicalQuery = url.search
      .replace(/^\?/, '')
      .split('&')
      .filter((part) => part !== '')
      .map((part) => {
        const [key, ...rest] = part.split('=');
        return [key, rest.join('=')] as const;
      })
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, headerNames, UNSIGNED_PAYLOAD].join('\n');
    const scopeDate = headers.get('x-amz-date')?.slice(0, 8) ?? '';
    const scope = `${scopeDate}/${this.config.s3.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      headers.get('x-amz-date') ?? '',
      scope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const dateKey = crypto.createHmac('sha256', `AWS4${this.config.s3.secretAccessKey}`).update(scopeDate).digest();
    const regionKey = crypto.createHmac('sha256', dateKey).update(this.config.s3.region).digest();
    const serviceKey = crypto.createHmac('sha256', regionKey).update('s3').digest();
    const signingKey = crypto.createHmac('sha256', serviceKey).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    return `AWS4-HMAC-SHA256 Credential=${this.config.s3.accessKeyId}/${scope}, SignedHeaders=${headerNames}, Signature=${signature}`;
  }
}
