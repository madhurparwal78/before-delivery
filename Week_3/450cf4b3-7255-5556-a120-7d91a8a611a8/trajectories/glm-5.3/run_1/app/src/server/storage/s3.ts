import crypto from 'node:crypto';
import { Config } from '../config.js';

// S3-compatible object storage client speaking AWS Signature V4 directly over
// fetch, so document files live as private objects the browser never touches.

export class StorageDown extends Error {
  constructor() { super('storage_down'); }
}

export type DetectedType = 'application/pdf' | 'image/png' | 'image/jpeg';

export function detectContentType(bytes: Uint8Array): DetectedType | null {
  if (bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2D) {
    return 'application/pdf';
  }
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
    && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg';
  }
  return null;
}

export function extFor(type: DetectedType): string {
  if (type === 'application/pdf') return 'pdf';
  if (type === 'image/png') return 'png';
  return 'jpg';
}

export class ObjectStore {
  private host: string;
  private pathStyle: boolean;

  constructor(private cfg: Config) {
    this.host = cfg.s3.endpoint.replace(/^https?:\/\//, '');
    this.pathStyle = cfg.s3.forcePathStyle;
  }

  private urlFor(key: string): { url: URL; host: string; canonicalUri: string } {
    const { bucket } = this.cfg.s3;
    if (this.pathStyle) {
      const url = new URL(`${this.cfg.s3.endpoint}/${bucket}/${key}`);
      return { url, host: this.host, canonicalUri: `/${bucket}/${key}` };
    }
    const url = new URL(`${this.cfg.s3.endpoint.replace('://' , `://${bucket}.`)}/${key}`);
    return { url, host: `${bucket}.${this.host}`, canonicalUri: `/${key}` };
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = crypto.createHmac('sha256', `AWS4${this.cfg.s3.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(this.cfg.s3.region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  }

  private async signedRequest(method: string, key: string, body: Uint8Array | null, extraHeaders: Record<string, string>): Promise<{ status: number; data: ArrayBuffer | null }> {
    const { url, host, canonicalUri } = this.urlFor(key);
    const payload = body === null ? new Uint8Array(0) : body;
    const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      ...extraHeaders,
    };
    const signedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers[h].trim()}\n`).join('');
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n');
    const scope = `${dateStamp}/${this.cfg.s3.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const signature = crypto.createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { ...headers, Authorization: authorization },
        body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.from(payload),
      });
    } catch {
      throw new StorageDown();
    }
    if (res.status >= 500) throw new StorageDown();
    const data = res.status >= 300 ? null : await res.arrayBuffer();
    if (res.status >= 300 && res.status !== 404) throw new StorageDown();
    return { status: res.status, data };
  }

  // Byte-identical storage: the object holds exactly the uploaded bytes.
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const r = await this.signedRequest('PUT', key, bytes, { 'content-type': contentType, 'content-length': String(bytes.length) });
    if (r.status !== 200 && r.status !== 201) throw new StorageDown();
  }

  async get(key: string): Promise<Uint8Array | null> {
    const r = await this.signedRequest('GET', key, null, {});
    if (r.status === 404 || r.data === null) return null;
    return new Uint8Array(r.data);
  }
}
