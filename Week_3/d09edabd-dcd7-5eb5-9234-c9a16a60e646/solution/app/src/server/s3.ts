import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { storageUnavailable } from './errors.js';

const PROBE_MS = 2000;
const TIMEOUT_MS = 8000;

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Uint8Array, data: string): Buffer => createHmac('sha256', key).update(data).digest();

interface StoredObject {
  body: Buffer;
  contentType: string;
}

/** The one S3-compatible client (MinIO): Signature V4 over fetch, with an availability flag from a probe. */
class ObjectStore {
  private up = false;

  get available(): boolean {
    return this.up;
  }

  start(): void {
    if (!config.s3.endpoint || !config.s3.bucket) return;
    void this.watch();
  }

  private async watch(): Promise<void> {
    for (;;) {
      try {
        const head = await this.send('HEAD', '');
        if (head.status === 404) {
          const made = await this.send('PUT', '');
          this.up = made.status === 200 || made.status === 409;
        } else {
          this.up = head.status === 200;
        }
      } catch {
        this.up = false;
      }
      await new Promise((resolve) => setTimeout(resolve, PROBE_MS));
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const response = await this.call('PUT', key, body, { 'content-type': contentType });
    if (response.status !== 200) throw this.broken();
  }

  /** The object, or null when the key does not exist. */
  async get(key: string): Promise<StoredObject | null> {
    const response = await this.call('GET', key);
    if (response.status === 404) return null;
    if (response.status !== 200) throw this.broken();
    return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async remove(key: string): Promise<void> {
    const response = await this.call('DELETE', key);
    if (response.status !== 204 && response.status !== 200 && response.status !== 404) throw this.broken();
  }

  private broken(): Error {
    this.up = false;
    return storageUnavailable();
  }

  private async call(method: string, key: string, body?: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
    try {
      return await this.send(method, key, body, headers);
    } catch {
      throw this.broken();
    }
  }

  private async send(method: string, key: string, body: Uint8Array = new Uint8Array(), extra: Record<string, string> = {}): Promise<Response> {
    const { endpoint, bucket, region, accessKeyId, secretAccessKey, pathStyle } = config.s3;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error('object storage is not configured');
    const base = new URL(endpoint);
    const host = pathStyle ? base.host : `${bucket}.${base.host}`;
    const path = (pathStyle ? `/${bucket}` : '') + (key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : pathStyle ? '' : '/');
    const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = now.slice(0, 8);
    const payloadHash = sha256(body);
    const signed: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': now };
    const names = Object.keys(signed).sort();
    const canonical = [method, path || '/', '', names.map((n) => `${n}:${signed[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
    const scope = `${day}/${region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256(canonical)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
    return fetch(`${base.protocol}//${host}${path}`, {
      method,
      headers: {
        ...extra,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': now,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
      },
      body: method === 'PUT' && key ? Uint8Array.from(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}

export const store = new ObjectStore();
