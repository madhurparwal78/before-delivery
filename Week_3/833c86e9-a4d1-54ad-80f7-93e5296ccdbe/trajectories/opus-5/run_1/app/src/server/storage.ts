import { createHash, createHmac } from 'node:crypto';
import { config } from './config';

let forcedDown = false;

export function setStorageDown(down: boolean): void {
  forcedDown = down;
}

export function storageForcedDown(): boolean {
  return forcedDown;
}

export class StorageDown extends Error {}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

interface S3Request {
  method: 'GET' | 'PUT' | 'HEAD';
  key: string;
  body?: Buffer;
  contentType?: string;
}

async function signedFetch(req: S3Request): Promise<Response> {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey, pathStyle } = config.s3;
  const base = new URL(endpoint);
  const path = pathStyle ? `/${bucket}/${encodePath(req.key)}` : `/${encodePath(req.key)}`;
  const url = new URL(path, base);
  const body = req.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const { stamp, date } = amzDate(new Date());
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (req.contentType) headers['content-type'] = req.contentType;
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers[h].trim()}\n`).join('');
  const canonicalRequest = [
    req.method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
  const init: RequestInit = { method: req.method, headers, signal: AbortSignal.timeout(5000) };
  if (req.method === 'PUT') init.body = body;
  return fetch(url, init);
}

async function call(req: S3Request): Promise<Response> {
  if (forcedDown) throw new StorageDown('storage down');
  try {
    return await signedFetch(req);
  } catch (err) {
    throw new StorageDown(String(err));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const res = await call({ method: 'PUT', key, body, contentType });
  if (!res.ok) throw new StorageDown(`put ${key} ${res.status}`);
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const res = await call({ method: 'GET', key });
  if (res.status === 404) return null;
  if (!res.ok) throw new StorageDown(`get ${key} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { body: buf, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function objectExists(key: string): Promise<boolean> {
  const res = await call({ method: 'HEAD', key });
  if (res.status === 404) return false;
  if (!res.ok) throw new StorageDown(`head ${key} ${res.status}`);
  return true;
}

export async function storageReachable(): Promise<boolean> {
  if (forcedDown) return false;
  try {
    const res = await call({ method: 'HEAD', key: '' });
    return res.status < 500;
  } catch {
    return false;
  }
}
