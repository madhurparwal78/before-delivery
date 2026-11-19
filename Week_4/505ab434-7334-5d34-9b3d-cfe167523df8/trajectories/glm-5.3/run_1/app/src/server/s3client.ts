import * as crypto from 'node:crypto';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const sha256hex = (data: crypto.BinaryLike): string =>
  crypto.createHash('sha256').update(data).digest('hex');

const hmac = (key: crypto.BinaryLike, data: string): Buffer =>
  crypto.createHmac('sha256', key).update(data, 'utf8').digest();

const enc = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** Minimal S3 REST client with SigV4 signing, scoped to one bucket. */
export class S3Client {
  constructor(readonly cfg: S3Config) {}

  private base(): URL {
    return new URL(`${this.cfg.endpoint.replace(/\/+$/, '')}/${this.cfg.bucket}`);
  }

  private objectUrl(key: string): URL {
    const url = this.base();
    url.pathname = `${url.pathname}/${key.split('/').map(enc).join('/')}`;
    return url;
  }

  private sortedUrl(url: URL): URL {
    const pairs: [string, string][] = [];
    url.searchParams.forEach((v, k) => pairs.push([k, v]));
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
    const out = new URL(url.toString());
    out.search = '';
    for (const [k, v] of pairs) out.searchParams.append(k, v);
    return out;
  }

  private sign(
    method: string,
    url: URL,
    headers: Record<string, string>,
    payload: Buffer | string,
  ): Record<string, string> {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const payloadHash = sha256hex(payload);
    const allHeaders: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    const names = Object.keys(allHeaders).sort();
    const canonicalHeaders = names.map((n) => `${n}:${allHeaders[n].trim()}\n`).join('');
    const signedHeaders = names.join(';');
    const canonical = this.sortedUrl(url);
    const canonicalRequest = [
      method,
      canonical.pathname,
      canonical.search.startsWith('?') ? canonical.search.slice(1) : '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${amzDate.slice(0, 8)}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.cfg.secretAccessKey}`, amzDate.slice(0, 8)), this.cfg.region), 's3'),
      'aws4_request',
    );
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    return {
      ...allHeaders,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  private async request(
    method: string,
    url: URL,
    body: Buffer | string = '',
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const headers = this.sign(method, url, extraHeaders, body);
    return fetch(url, {
      method,
      headers,
      body: body === '' ? undefined : new Uint8Array(body as Buffer),
    });
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (contentType) headers['content-type'] = contentType;
    const res = await this.request('PUT', this.objectUrl(key), body, headers);
    if (!res.ok) throw new Error(`s3 put ${key} -> ${res.status}`);
  }

  async head(key: string): Promise<{ size: number } | null> {
    const res = await this.request('HEAD', this.objectUrl(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`s3 head ${key} -> ${res.status}`);
    return { size: Number(res.headers.get('content-length') ?? '0') };
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.request('GET', this.objectUrl(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`s3 get ${key} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const res = await this.request('DELETE', this.objectUrl(key));
    if (!res.ok && res.status !== 404) throw new Error(`s3 delete ${key} -> ${res.status}`);
  }

  async list(prefix: string): Promise<string[]> {
    const url = this.base();
    url.searchParams.set('list-type', '2');
    url.searchParams.set('max-keys', '1000');
    if (prefix) url.searchParams.set('prefix', prefix);
    const res = await this.request('GET', url);
    if (!res.ok) throw new Error(`s3 list -> ${res.status}`);
    const text = await res.text();
    const keys: string[] = [];
    const re = /<Key>([^<]+)<\/Key>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) keys.push(m[1]);
    return keys;
  }

  async removePrefix(prefix: string): Promise<void> {
    for (const key of await this.list(prefix)) await this.remove(key);
  }

  async bucketExists(): Promise<boolean> {
    const res = await this.request('GET', this.base());
    if (res.ok) return true;
    if (res.status === 404) return false;
    throw new Error(`s3 bucket check -> ${res.status}`);
  }

  async createBucket(): Promise<void> {
    const res = await this.request('PUT', this.base());
    if (!res.ok && res.status !== 409) throw new Error(`s3 create bucket -> ${res.status}`);
  }
}

export function s3Key(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/');
}
