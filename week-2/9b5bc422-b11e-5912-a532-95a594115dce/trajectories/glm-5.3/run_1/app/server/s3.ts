import crypto from 'node:crypto';

// Minimal S3 REST client with AWS SigV4. Only the object operations the app
// needs: putObject, getObject, deleteObject.

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}


export class S3Client {
  private cfg: S3Config;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
  }

  private url(key: string): { url: URL; host: string; path: string } {
    const ep = new URL(this.cfg.endpoint);
    const bucket = this.cfg.bucket;
    let path: string;
    let host: string;
    if (this.cfg.forcePathStyle) {
      path = `/${bucket}/${key}`;
      host = ep.host;
    } else {
      host = `${bucket}.${ep.host}`;
      path = `/${key}`;
    }
    const url = new URL(ep.protocol + '//' + host + path);
    return { url, host, path };
  }

  private sign(method: string, key: string, payload: Buffer, contentType?: string): { url: URL; headers: Record<string, string> } {
    const { url, host, path } = this.url(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(payload);
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
      method,
      path,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { url, headers };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<boolean> {
    const { url, headers } = this.sign('PUT', key, body, contentType);
    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });
    return res.ok;
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const { url, headers } = this.sign('GET', key, Buffer.alloc(0));
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) return null;
    const body = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    return { body, contentType };
  }

  async delete(key: string): Promise<boolean> {
    const { url, headers } = this.sign('DELETE', key, Buffer.alloc(0));
    const res = await fetch(url, { method: 'DELETE', headers });
    return res.ok || res.status === 404;
  }
}
