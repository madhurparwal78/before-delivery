import { createHmac, createHash } from 'node:crypto';
import { memoStorageUnavailable } from '../shared/errors.js';

const TIMEOUT_MS = 10_000;

export interface StoredMemo {
  body: Buffer;
  contentType: string;
  size: number;
  durationMs: number | null;
}

export class MinioClient {
  constructor(
    private readonly endpoint: string,
    private readonly region: string,
    private readonly bucket: string,
    private readonly forcePathStyle: boolean,
    private readonly accessKey: string,
    private readonly secretKey: string,
  ) {}

  private objectUrl(key: string): URL {
    const base = this.endpoint.replace(/\/+$/, '');
    return this.forcePathStyle ? new URL(`${base}/${this.bucket}/${key}`) : new URL(`${base}/${key}`);
  }

  private async request(method: string, key: string, body: Buffer | undefined, headers: Record<string, string>, allowStatuses: readonly number[]): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = this.objectUrl(key);
      const { host, pathname, search } = url;
      const now = new Date();
      // MinIO parses x-amz-date as ISO8601 with the trailing Z.
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);
      const payloadHash = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
      const allHeaders: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...lowerCased(headers) };
      const sorted = Object.keys(allHeaders).sort();
      const canonicalHeaders = sorted.map((k) => `${k}:${String(allHeaders[k] ?? '').trim()}\n`).join('');
      const signedHeaders = sorted.join(';');
      const canonicalRequest = [method, pathname, search.replace(/^\?/, ''), canonicalHeaders, signedHeaders, payloadHash].join('\n');
      const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
      const kDate = createHmac('sha256', `AWS4${this.secretKey}`).update(dateStamp).digest();
      const kRegion = createHmac('sha256', kDate).update(this.region).digest();
      const kService = createHmac('sha256', kRegion).update('s3').digest();
      const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
      const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
      const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      const response = await fetch(url, {
        method,
        headers: { ...allHeaders, Authorization: authorization },
        body: body === undefined ? undefined : new Uint8Array(body),
        signal: controller.signal,
      });
      const buf = Buffer.from(await response.arrayBuffer());
      if (response.status >= 500 || (!response.ok && !allowStatuses.includes(response.status))) {
        throw memoStorageUnavailable();
      }
      const flat: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        flat[k] = v;
      });
      return { status: response.status, headers: flat, body: buf };
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TypeError' || err.message.includes('fetch failed'))) {
        throw memoStorageUnavailable();
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async put(key: string, body: Buffer, contentType: string, durationMs: number): Promise<void> {
    await this.request('PUT', key, body, { 'Content-Type': contentType, 'x-amz-meta-duration-ms': String(durationMs) }, []);
  }

  async get(key: string): Promise<StoredMemo> {
    const { body, headers } = await this.request('GET', key, undefined, {}, [404]);
    const meta = headers['x-amz-meta-duration-ms'];
    return {
      body,
      contentType: headers['content-type'] ?? 'application/octet-stream',
      size: body.length,
      durationMs: meta === undefined ? null : Number(meta),
    };
  }
}

// SigV4 signs lowercase header names.
function lowerCased(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}
