import crypto from 'node:crypto';
import http from 'node:http';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3Config(): S3Config {
  return {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  };
}

interface S3Request {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  key: string;
  body?: Buffer;
  contentType?: string;
}

/** Minimal AWS SigV4 + S3 client over Node's http, path-style or virtual-host. */
export class Minio {
  private cfg: S3Config;
  private available = true;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  private endpointParts(): { host: string; port: number; protocol: string } {
    const url = new URL(this.cfg.endpoint);
    return { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), protocol: url.protocol };
  }

  private urlFor(key: string): { host: string; port: number; path: string; protocol: string } {
    const { host, port, protocol } = this.endpointParts();
    const bucket = this.cfg.bucket;
    const path = this.cfg.forcePathStyle ? `/${bucket}/${key}` : `/${key}`;
    const finalHost = this.cfg.forcePathStyle ? host : `${bucket}.${host}`;
    return { host: finalHost, port, path: encodePath(path), protocol };
  }

  async request(req: S3Request): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
    const { host, port, path, protocol } = this.urlFor(req.key);
    const url = new URL(`${protocol}//${host}${port ? `:${port}` : ''}${path}`);
    const method = req.method;
    const payload = req.body ?? Buffer.alloc(0);
    const bodyHash = crypto.createHash('sha256').update(payload).digest('hex');
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const signedHeadersObj: Record<string, string> = { host: url.host, 'x-amz-content-sha256': bodyHash, 'x-amz-date': amzDate };
    if (req.contentType) signedHeadersObj['content-type'] = req.contentType;
    const signedHeaders = Object.keys(signedHeadersObj).sort();
    const canonicalHeaders = signedHeaders.map((h) => `${h}:${signedHeadersObj[h]}\n`).join('');
    const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders.join(';'), bodyHash].join('\n');
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

    return new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: url.hostname,
          port: url.port || 80,
          method,
          path: url.pathname,
          headers: {
            ...signedHeadersObj,
            Authorization: authorization,
            'Content-Length': String(payload.length),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            this.available = true;
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
          });
        },
      );
      r.setTimeout(8000, () => r.destroy(new Error('storage timeout')));
      r.on('error', (err) => {
        this.available = false;
        reject(err);
      });
      if (payload.length) r.write(payload);
      r.end();
    });
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<boolean> {
    try {
      const res = await this.request({ method: 'PUT', key, body, contentType });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const res = await this.request({ method: 'GET', key });
      if (res.status >= 200 && res.status < 300) return res.body;
      return null;
    } catch {
      return null;
    }
  }

  async ensureBucket(): Promise<void> {
    try {
      const res = await this.request({ method: 'HEAD', key: '' });
      if (res.status === 404) {
        const u = new URL(this.cfg.endpoint);
        await new Promise<void>((resolve) => {
          const body = Buffer.from(`<CreateBucketConfiguration><LocationConstraint>${this.cfg.region}</LocationConstraint></CreateBucketConfiguration>`);
          const r = http.request(
            {
              host: u.hostname,
              port: Number(u.port || 80),
              method: 'PUT',
              path: `/${this.cfg.bucket}`,
              headers: { 'Content-Length': String(body.length) },
            },
            (res2) => {
              res2.resume();
              res2.on('end', () => resolve());
            },
          );
          r.on('error', () => resolve());
          r.write(body);
          r.end();
        });
      }
      this.available = true;
    } catch {
      this.available = false;
    }
  }
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export const MINIO = new Minio(s3Config());
