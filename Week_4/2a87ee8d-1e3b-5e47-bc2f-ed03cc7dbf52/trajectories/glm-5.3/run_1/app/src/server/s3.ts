/** Minimal S3 (MinIO) client with SigV4, plus health probing. */
import { createHmac, createHash } from 'node:crypto';
import type { Config } from './config.js';

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface S3Client {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
  ensureBucket(): Promise<void>;
}

export function createS3Client(cfg: Config): S3Client {
  const endpoint = new URL(cfg.s3.endpoint);
  const host = endpoint.host; // includes port
  const base = `${endpoint.protocol}//${host}`;
  const region = cfg.s3.region;
  const bucket = cfg.s3.bucket;
  const accessKey = cfg.s3.accessKeyId;
  const secretKey = cfg.s3.secretAccessKey;
  const pathStyle = cfg.s3.forcePathStyle;

  function urlFor(key: string): URL {
    const path = pathStyle ? `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}` : `/${key.split('/').map(encodeURIComponent).join('/')}`;
    const u = new URL(`${base}${path}`);
    u.hostname = pathStyle ? endpoint.hostname : `${bucket}.${endpoint.hostname}`;
    if (endpoint.port) u.port = String(endpoint.port);
    return u;
  }

  async function signedFetch(method: string, key: string, body: Buffer, contentType?: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const u = urlFor(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = {
      host: u.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    if (contentType) headers['content-type'] = contentType;
    const signedHeadersList = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const canonicalHeaders = signedHeadersList.map((h) => `${h}:${headers[h]}\n`).join('');
    const canonicalRequest = [
      method, u.pathname, '', canonicalHeaders, signedHeadersList.join(';'), payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256', amzDate, scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeadersList.join(';')}, Signature=${signature}`;
    return fetch(u, {
      method,
      headers: { ...headers, authorization },
      body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : body,
    });
  }

  return {
    async ensureBucket(): Promise<void> {
      const exists = await signedFetch('HEAD', '', Buffer.alloc(0));
      if (exists.status === 404) {
        const create = await signedFetch('PUT', '', Buffer.alloc(0));
        if (!create.ok) throw new Error(`bucket create failed: ${create.status}`);
        return;
      }
      if (!exists.ok) throw new Error(`bucket check failed: ${exists.status}`);
    },
    async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
      const res = await signedFetch('PUT', key, body, contentType);
      if (!res.ok) throw new Error(`put failed: ${res.status} ${await res.text().catch(() => '')}`);
    },
    async getObject(key: string): Promise<Buffer | null> {
      const res = await signedFetch('GET', key, Buffer.alloc(0));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`get failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async deleteObject(key: string): Promise<void> {
      const res = await signedFetch('DELETE', key, Buffer.alloc(0));
      if (res.status === 404) return;
      if (!res.ok) throw new Error(`delete failed: ${res.status}`);
    },
  };
}

export function imageKey(workshopId: string, imageId: string): string {
  return `workshops/${workshopId}/images/${imageId}`;
}
export function recapPdfKey(workshopId: string): string {
  return `workshops/${workshopId}/recap/board.pdf`;
}
export function recapCsvKey(workshopId: string): string {
  return `workshops/${workshopId}/recap/notes.csv`;
}
export function recapFrameKey(workshopId: string, frameId: string): string {
  return `workshops/${workshopId}/recap/frames/${frameId}.png`;
}
