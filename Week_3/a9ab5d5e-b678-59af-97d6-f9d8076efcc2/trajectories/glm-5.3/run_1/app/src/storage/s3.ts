/** Storage: MinIO S3-compatible client with AWS SigV4, made with the
 *  services described in the brief. No other hosts are contacted. */
import { createHmac, createHash } from 'node:crypto';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class StorageUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailable';
  }
}

export class S3 {
  private readonly cfg: S3Config;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
  }

  private endpointUrl(): URL {
    const u = new URL(this.cfg.endpoint);
    if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
    return u;
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.request('PUT', key, body, { 'content-type': contentType, 'x-amz-content-sha256': sha256Hex(body) });
    if (!res.ok) throw new StorageUnavailable(`put failed: ${res.status}`);
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.request('GET', key, undefined, {});
    if (!res.ok) throw new StorageUnavailable(`get failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.request('DELETE', key, undefined, {});
    if (!res.ok && res.status !== 404) throw new StorageUnavailable(`delete failed: ${res.status}`);
  }

  async bucketExists(): Promise<boolean> {
    try {
      const res = await this.request('HEAD', '', undefined, {});
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Ensure the bucket exists (idempotent). */
  async ensureBucket(): Promise<void> {
    const res = await this.request('PUT', '', undefined, {});
    if (!res.ok && res.status !== 409) {
      const text = await res.text().catch(() => '');
      throw new StorageUnavailable(`bucket create failed: ${res.status} ${text.slice(0, 120)}`);
    }
  }

  private async request(
    method: string,
    key: string,
    body: Buffer | undefined,
    headers: Record<string, string>,
  ): Promise<Response> {
    const base = this.endpointUrl();
    // path-style: the key carries the bucket prefix when the endpoint hosts
    // more than one bucket; virtual-host style puts the bucket in the host.
    const fullKey = this.cfg.forcePathStyle ? `${this.cfg.bucket}/${key}` : key;
    const path = key ? `${base.pathname}${fullKey}` : `${base.pathname}${this.cfg.bucket}`;
    const url = new URL(base.toString());
    url.pathname = path;
    if (!this.cfg.forcePathStyle) {
      // virtual-host style: bucket.host
      const u = new URL(base.toString());
      url.host = `${this.cfg.bucket}.${u.host}`;
    }
    const host = url.host;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = body ? sha256Hex(body) : sha256Hex(Buffer.alloc(0));
    const signedHeaders: Record<string, string> = {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    delete (signedHeaders as Record<string, string | undefined>).contentLength;
    const headerNames = Object.keys(signedHeaders).sort();
    const canonicalHeaders = headerNames.map((h) => `${h}:${signedHeaders[h]}\n`).join('');
    const signedHeaderList = headerNames.join(';');
    const canonicalRequest = [
      method,
      url.pathname || '/',
      url.search.replace(/^\?/, ''),
      canonicalHeaders,
      signedHeaderList,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
    ].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp), this.cfg.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;
    const fetchHeaders: Record<string, string> = {
      authorization,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    };
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() !== 'host') fetchHeaders[k] = v;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url.toString(), {
        method,
        headers: fetchHeaders,
        body: body ? new Uint8Array(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res;
    } catch (e) {
      throw new StorageUnavailable(`unreachable: ${(e as Error).message}`);
    }
  }
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
