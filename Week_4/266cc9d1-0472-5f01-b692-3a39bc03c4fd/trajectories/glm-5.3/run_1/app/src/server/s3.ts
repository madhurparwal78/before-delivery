import { createHash, createHmac } from 'node:crypto';

/**
 * Minimal AWS SigV4 S3 client over fetch, for MinIO. No SDK dependency.
 */

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export function s3Config(): S3Config {
  const endpoint = process.env.S3_ENDPOINT ?? '';
  const bucket = process.env.S3_BUCKET ?? '';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? '';
  const region = process.env.S3_REGION ?? 'us-east-1';
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false';
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 configuration is incomplete');
  }
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const ch of value) {
    if (/[A-Za-z0-9_.~-]/.test(ch)) {
      out += ch;
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/';
    } else {
      const bytes = Buffer.from(ch, 'utf8');
      for (const b of bytes) out += '%' + b.toString(16).toUpperCase();
    }
  }
  return out;
}

export class S3Client {
  private cfg: S3Config;
  private host: string;
  constructor(cfg: S3Config) {
    this.cfg = cfg;
    const url = new URL(cfg.endpoint);
    this.host = url.host;
  }

  private baseUrl(): string {
    if (this.cfg.forcePathStyle) {
      return `${this.cfg.endpoint.replace(/\/+$/, '')}/${this.cfg.bucket}`;
    }
    const url = new URL(this.cfg.endpoint);
    return `${url.protocol}//${this.cfg.bucket}.${url.host}`;
  }

  private signedRequest(
    method: string,
    key: string,
    opts: {
      body?: Buffer | Uint8Array | string;
      headers?: Record<string, string>;
      query?: Record<string, string>;
      unsignedPayload?: boolean;
    } = {}
  ): Request {
    const url = new URL(`${this.baseUrl()}/${uriEncode(key, false)}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
    }
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = opts.unsignedPayload
      ? 'UNSIGNED-PAYLOAD'
      : sha256Hex(typeof opts.body === 'string' ? Buffer.from(opts.body) : (opts.body as Buffer) ?? Buffer.alloc(0));
    const headers: Record<string, string> = {
      host: this.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    };
    // Sort and canonicalise.
    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k].trim()}\n`).join('');
    const signedHeaders = sortedKeys.join(';');
    const canonicalQuery = [...url.searchParams.entries()]
      .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
      .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const canonicalUri = `/${this.cfg.bucket}/${uriEncode(key, false)}`.replace(/\/+/g, '/');
    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp), this.cfg.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const realHeaders: Record<string, string> = { ...(opts.headers ?? {}) };
    delete realHeaders.host;
    realHeaders['x-amz-content-sha256'] = payloadHash;
    realHeaders['x-amz-date'] = amzDate;
    realHeaders['authorization'] = authorization;
    const bodyBytes = opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : new Uint8Array(opts.body);
    return new Request(url, { method, headers: realHeaders, body: bodyBytes });
  }

  async putObject(key: string, body: Buffer, checksumSha256: string): Promise<{ etag: string } | null> {
    const req = this.signedRequest('PUT', key, {
      body,
      headers: { 'content-type': 'application/octet-stream', 'x-amz-sdk-checksum-algorithm': 'SHA256', 'x-amz-checksum-sha256': Buffer.from(checksumSha256, 'hex').toString('base64') },
    });
    try {
      const res = await fetch(req);
      if (res.status >= 200 && res.status < 300) {
        const etag = (res.headers.get('etag') ?? '').replace(/"/g, '');
        return { etag };
      }
      return null;
    } catch {
      return null;
    }
  }

  async headObject(key: string): Promise<{ size: number; etagSha256: string } | null> {
    const req = this.signedRequest('HEAD', key, { headers: { 'x-amz-checksum-mode': 'ACTIVE' } });
    try {
      const res = await fetch(req);
      if (res.status !== 200) return null;
      const size = Number(res.headers.get('content-length') ?? '-1');
      if (size < 0) return null;
      // MinIO serves the object's SHA-256 as x-amz-checksum-sha256 when the
      // object carries one; otherwise read it back and hash it.
      const checksumHeader = res.headers.get('x-amz-checksum-sha256') ?? '';
      if (checksumHeader) {
        try {
          const hex = Buffer.from(checksumHeader, 'base64').toString('hex');
          if (/^[0-9a-f]{64}$/.test(hex)) return { size, etagSha256: hex };
        } catch { /* fall through */ }
      }
      const body = await this.getObject(key);
      if (body === null) return null;
      return { size, etagSha256: createHash('sha256').update(body.body).digest('hex') };
    } catch {
      return null;
    }
  }

  async getObject(key: string, range?: { from: number; to: number }): Promise<{ body: Buffer; size: number } | null> {
    const headers: Record<string, string> = {};
    if (range) headers['range'] = `bytes=${range.from}-${range.to}`;
    const req = this.signedRequest('GET', key, { headers });
    try {
      const res = await fetch(req);
      if (res.status === 200 || res.status === 206) {
        const body = Buffer.from(await res.arrayBuffer());
        const size = Number(res.headers.get('content-length') ?? body.length);
        return { body, size };
      }
      return null;
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<boolean> {
    const req = this.signedRequest('DELETE', key);
    try {
      const res = await fetch(req);
      return res.status === 204 || res.status === 200;
    } catch {
      return false;
    }
  }

  async listObjects(prefix: string): Promise<string[]> {
    const req = this.signedRequest('GET', '', { query: { 'list-type': '2', prefix, 'max-keys': '1000' } });
    try {
      const res = await fetch(req);
      if (res.status !== 200) return [];
      const text = await res.text();
      const keys: string[] = [];
      const re = /<Key>([^<]*)<\/Key>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) keys.push(m[1]);
      return keys;
    } catch {
      return [];
    }
  }

  /** Probe reachability with a cheap authenticated list. */
  async probe(): Promise<boolean> {
    try {
      const req = this.signedRequest('GET', '', { query: { 'list-type': '2', 'max-keys': '1' } });
      const res = await fetch(req, { signal: AbortSignal.timeout(3000) });
      return res.status < 500;
    } catch {
      return false;
    }
  }
}
