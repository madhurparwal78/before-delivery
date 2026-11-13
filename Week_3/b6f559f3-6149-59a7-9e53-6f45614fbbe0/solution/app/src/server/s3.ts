/** MinIO storage over the S3 API: SigV4 requests with fetch, path style. Objects count once read back by `head`. */
import { createHash, createHmac } from 'node:crypto';

interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class StorageUnavailable extends Error {
  constructor(detail: string) {
    super(`Storage is unavailable: ${detail}`);
  }
}

interface ObjectHead {
  size: number;
  contentType: string;
}

const REQUEST_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 1500;

const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encode = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface Reply {
  status: number;
  headers: Headers;
  body: Buffer;
}

export class Storage {
  private bucketReady = false;
  private creating: Promise<void> | null = null;

  constructor(private readonly settings: S3Settings) {}

  private sign(method: string, path: string, query: string, payloadHash: string, headers: Record<string, string>): Record<string, string> {
    const url = new URL(this.settings.endpoint);
    const now = new Date();
    const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = stamp.slice(0, 8);
    const all: Record<string, string> = { ...headers, host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
    const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
    const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v.trim()]));
    const canonical = [method, path, query, ...names.map((n) => `${n}:${lower[n]}`), '', names.join(';'), payloadHash].join('\n');
    const scope = `${date}/${this.settings.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
    const key = hmac(hmac(hmac(hmac(`AWS4${this.settings.secretAccessKey}`, date), this.settings.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', key).update(toSign).digest('hex');
    return {
      ...all,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.settings.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    };
  }

  private async send(
    method: string,
    key: string | null,
    options: { query?: Record<string, string>; body?: Uint8Array; contentType?: string; timeout?: number } = {},
  ): Promise<Reply> {
    const path = `/${encode(this.settings.bucket)}${key === null ? '' : `/${key.split('/').map(encode).join('/')}`}`;
    const query = Object.entries(options.query ?? {})
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encode(k)}=${encode(v)}`)
      .join('&');
    const body = options.body ?? new Uint8Array(0);
    const extra: Record<string, string> = options.contentType ? { 'content-type': options.contentType } : {};
    const headers = this.sign(method, path, query, sha256(body), extra);
    try {
      const response = await fetch(`${this.settings.endpoint}${path}${query ? `?${query}` : ''}`, {
        method,
        headers,
        body: method === 'PUT' || method === 'POST' ? (body as unknown as BodyInit) : undefined,
        signal: AbortSignal.timeout(options.timeout ?? REQUEST_TIMEOUT_MS),
      });
      return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      throw new StorageUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  /** Creates the bucket when it is missing and keeps an existing one. Throws StorageUnavailable while storage is down. */
  async ensureBucket(timeout = REQUEST_TIMEOUT_MS): Promise<void> {
    if (this.bucketReady) return;
    this.creating ??= (async () => {
      try {
        const head = await this.send('HEAD', null, { timeout });
        if (head.status === 404) {
          const made = await this.send('PUT', null, { timeout });
          if (made.status >= 300 && made.status !== 409) throw new StorageUnavailable(`bucket create answered ${made.status}`);
        } else if (head.status >= 500) throw new StorageUnavailable(`bucket check answered ${head.status}`);
        else if (head.status === 403) throw new StorageUnavailable('bucket access refused');
        this.bucketReady = true;
      } finally {
        this.creating = null;
      }
    })();
    await this.creating;
  }

  /** True when storage answers. Creates the bucket as soon as it can. */
  async healthy(): Promise<boolean> {
    try {
      await this.ensureBucket(PROBE_TIMEOUT_MS);
      const head = await this.send('HEAD', null, { timeout: PROBE_TIMEOUT_MS });
      return head.status === 200;
    } catch {
      return false;
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.ensureBucket();
    const reply = await this.send('PUT', key, { body: bytes, contentType });
    if (reply.status >= 300) throw new StorageUnavailable(`put answered ${reply.status}`);
  }

  /** The object's metadata read back, or null when it does not exist. */
  async head(key: string): Promise<ObjectHead | null> {
    await this.ensureBucket();
    const reply = await this.send('HEAD', key);
    if (reply.status === 404) return null;
    if (reply.status >= 300) throw new StorageUnavailable(`head answered ${reply.status}`);
    return { size: Number(reply.headers.get('content-length') ?? 0), contentType: reply.headers.get('content-type') ?? '' };
  }

  async get(key: string): Promise<Buffer | null> {
    await this.ensureBucket();
    const reply = await this.send('GET', key);
    if (reply.status === 404) return null;
    if (reply.status >= 300) throw new StorageUnavailable(`get answered ${reply.status}`);
    return reply.body;
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucket();
    const reply = await this.send('DELETE', key);
    if (reply.status >= 300 && reply.status !== 404) throw new StorageUnavailable(`delete answered ${reply.status}`);
  }

  async list(prefix: string): Promise<string[]> {
    await this.ensureBucket();
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) };
      const reply = await this.send('GET', null, { query });
      if (reply.status >= 300) throw new StorageUnavailable(`list answered ${reply.status}`);
      const xml = reply.body.toString('utf8');
      for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(unescapeXml(match[1] as string));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined;
    } while (token);
    return keys;
  }

  /** Deletes every object, as the grading reset does. */
  async emptyBucket(): Promise<void> {
    for (const key of await this.list('')) await this.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of await this.list(prefix)) await this.delete(key);
  }
}

const unescapeXml = (text: string): string =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export const assetKey = (projectId: string, assetId: string): string => `projects/${projectId}/assets/${assetId}/original`;
export const importKey = (projectId: string): string => `projects/${projectId}/imports/original.json`;
export const bundleKey = (projectId: string, version: number): string => `projects/${projectId}/versions/${version}/scene.json`;
