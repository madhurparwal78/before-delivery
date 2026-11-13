import { createHmac, createHash } from 'node:crypto';

/** Minimal AWS SigV4 + S3 client using fetch, per DP-03 credentials from config only. */
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3 {
  private readonly host: string;
  private readonly port: number;
  private readonly scheme: string;

  constructor(private readonly config: S3Config) {
    const url = new URL(config.endpoint);
    this.host = url.hostname;
    this.port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
    this.scheme = url.protocol.replace(':', '');
  }

  private keyUrl(key: string): URL {
    const base = this.config.forcePathStyle
      ? `${this.scheme}://${this.host}:${this.port}/${this.config.bucket}/${key}`
      : `${this.scheme}://${this.config.bucket}.${this.host}:${this.port}/${key}`;
    return new URL(base);
  }

  private sign(method: string, url: URL, payload: Buffer | null, extraHeaders: Record<string, string> = {}): Record<string, string> {
    const now = new Date();
    const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = payload ? createHash('sha256').update(payload).digest('hex') : EMPTY_SHA;
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k].trim()}\n`).join('');
    const signedHeaders = sortedKeys.join(';');
    const canonicalRequest = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = createHmac('sha256', `AWS4${this.config.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(this.config.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
    const auth = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const out: Record<string, string> = { authorization: auth };
    for (const key of sortedKeys) out[key] = headers[key];
    return out;
  }

  private async request(method: string, url: URL, body: Buffer | null, headers: Record<string, string>): Promise<Response> {
    const signed = this.sign(method, url, body, headers);
    return fetch(url, {
      method,
      headers: { ...signed, ...(body ? { 'content-length': String(body.length) } : {}) },
      body: body === null ? undefined : new Uint8Array(body),
      signal: AbortSignal.timeout(10000),
    });
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const url = this.keyUrl(key);
    const response = await this.request('PUT', url, body, { 'content-type': contentType });
    if (!response.ok) {
      await response.arrayBuffer();
      throw new S3Error(`put ${key} failed with ${response.status}`);
    }
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const url = this.keyUrl(key);
    const response = await this.request('GET', url, null, {});
    if (response.status === 404) return null;
    if (!response.ok) {
      await response.arrayBuffer();
      throw new S3Error(`get ${key} failed with ${response.status}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    return { body, contentType: response.headers.get('content-type') || 'application/octet-stream' };
  }

  async delete(key: string): Promise<void> {
    const url = this.keyUrl(key);
    const response = await this.request('DELETE', url, null, {});
    await response.arrayBuffer();
  }

  async ping(): Promise<boolean> {
    try {
      const url = this.keyUrl('healthcheck.txt');
      const response = await this.request('PUT', url, Buffer.from('ok'), { 'content-type': 'text/plain' });
      if (!response.ok) return false;
      const readBack = await this.request('GET', url, null, {});
      const body = await readBack.text();
      await this.request('DELETE', url, null, {}).catch(() => {});
      return body === 'ok';
    } catch {
      return false;
    }
  }

  async ensureBucket(): Promise<void> {
    // Head bucket; create if missing.
    const url = new URL(
      this.config.forcePathStyle
        ? `${this.scheme}://${this.host}:${this.port}/${this.config.bucket}`
        : `${this.scheme}://${this.config.bucket}.${this.host}:${this.port}`,
    );
    const head = await fetch(url, {
      method: 'HEAD',
      headers: this.sign('HEAD', url, null, {}),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (head && head.ok) return;
    const response = await this.request('PUT', url, Buffer.alloc(0), {}).catch(() => null);
    if (response && !response.ok) {
      await response.arrayBuffer().catch(() => {});
    }
  }
}

export class S3Error extends Error {}

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
