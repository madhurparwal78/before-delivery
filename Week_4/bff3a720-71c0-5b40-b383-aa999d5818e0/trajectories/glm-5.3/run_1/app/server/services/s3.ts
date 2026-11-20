import crypto from 'crypto';
import http from 'http';

/**
 * S3 REST client with AWS SigV4 for PUT/GET/HEAD on MinIO.
 * Signs exactly the headers it sends, so the canonical request matches the wire.
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

interface S3Reply { ok: boolean; status: number; headers: http.IncomingHttpHeaders; body: Buffer | null }

export class S3 {
  readonly #cfg: S3Config;
  readonly #host: string;
  readonly #port: number;

  constructor(cfg: S3Config) {
    this.#cfg = cfg;
    const u = new URL(cfg.endpoint);
    this.#host = u.hostname;
    this.#port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<boolean> {
    const headers: Record<string, string> = { 'Content-Type': contentType };
    const res = await this.request('PUT', key, body, headers);
    return res.ok;
  }

  async headObject(key: string): Promise<{ exists: boolean; size: number | null }> {
    const res = await this.request('HEAD', key, Buffer.alloc(0), {});
    if (!res.ok) return { exists: false, size: null };
    const len = res.headers['content-length'];
    const text = Array.isArray(len) ? len[0] : len;
    return { exists: true, size: text ? Number(text) : null };
  }

  async getObject(key: string): Promise<{ ok: boolean; body: Buffer | null; contentType: string | null }> {
    const res = await this.request('GET', key, Buffer.alloc(0), {});
    if (!res.ok) return { ok: false, body: null, contentType: null };
    const ct = res.headers['content-type'];
    return { ok: true, body: res.body, contentType: Array.isArray(ct) ? ct[0] : ct ?? null };
  }

  async healthy(): Promise<boolean> {
    const res = await this.request('GET', '', Buffer.alloc(0), {});
    return res.status >= 200 && res.status < 500;
  }

  async request(method: string, key: string, body: Buffer, extraHeaders: Record<string, string>): Promise<S3Reply> {
    const bucketPath = '/' + this.#cfg.bucket + (key === '' ? '/' : '/' + key.split('/').map(encodeURIComponent).join('/'));
    const headers = await this.sign(method, bucketPath, body, extraHeaders);
    headers['content-length'] = String(body.length);
    return new Promise(resolve => {
      const r = http.request(
        { host: this.#host, port: this.#port, method, path: bucketPath, headers },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode ?? 0, headers: res.headers, body: method === 'HEAD' ? null : Buffer.concat(chunks) }));
        },
      );
      r.on('error', () => resolve({ ok: false, status: 0, headers: {}, body: null }));
      if (body.length > 0) r.write(body);
      r.end();
    });
  }

  async sign(method: string, path: string, body: Buffer, extra: Record<string, string>): Promise<Record<string, string>> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
    const all: Record<string, string> = {
      host: `${this.#host}:${this.#port}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extra,
    };
    const sortedKeys = Object.keys(all).sort();
    const canonicalHeaders = sortedKeys.map(k => `${k.toLowerCase()}:${all[k].trim()}\n`).join('');
    const signedHeaders = sortedKeys.map(k => k.toLowerCase()).join(';');
    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.#cfg.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const kDate = hmac(`AWS4${this.#cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.#cfg.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    return {
      ...extra,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.#cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}


