import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const SERVICE = 's3';
const REQUEST_TIMEOUT_MS = 4000;

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('storage unavailable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface StorageRequest {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  path: string;
  body?: Buffer;
}

async function send({ method, path, body }: StorageRequest): Promise<Response> {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalPath = encodePath(path);
  const url = new URL(canonicalPath, endpoint);
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = createHash('sha256').update(payload).digest('hex');
  const { stamp, date } = amzDate(new Date());
  const host = url.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${headers[name]}\n`)
    .join('');
  const canonicalRequest = [
    method,
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const requestHeaders: Record<string, string> = {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  };
  if (method === 'PUT') requestHeaders['content-length'] = String(payload.length);

  try {
    return await fetch(url, {
      method,
      headers: requestHeaders,
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

function objectPath(ownerId: string, blobId: string): string {
  return `/${config.s3.bucket}/blobs/${ownerId}/${blobId}`;
}

async function bucketRequest(method: 'GET' | 'PUT' | 'HEAD'): Promise<Response> {
  return send({ method, path: `/${config.s3.bucket}` });
}

export async function ensureBucket(): Promise<void> {
  const head = await bucketRequest('HEAD');
  if (head.status === 404) {
    const created = await bucketRequest('PUT');
    if (!created.ok && created.status !== 409) {
      throw new StorageUnavailable(new Error(`bucket create failed: ${created.status}`));
    }
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await bucketRequest('HEAD');
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function putObject(
  ownerId: string,
  blobId: string,
  body: Buffer,
): Promise<void> {
  const response = await send({ method: 'PUT', path: objectPath(ownerId, blobId), body });
  if (!response.ok) throw new StorageUnavailable(new Error(`put failed: ${response.status}`));
}

/** The stored object's size, or null when object storage has no such object. */
export async function objectSize(ownerId: string, blobId: string): Promise<number | null> {
  const response = await send({ method: 'HEAD', path: objectPath(ownerId, blobId) });
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(new Error(`head failed: ${response.status}`));
  const length = response.headers.get('content-length');
  return length === null ? null : Number.parseInt(length, 10);
}

export async function getObject(ownerId: string, blobId: string): Promise<Buffer | null> {
  const response = await send({ method: 'GET', path: objectPath(ownerId, blobId) });
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(new Error(`get failed: ${response.status}`));
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(ownerId: string, blobId: string): Promise<void> {
  try {
    await send({ method: 'DELETE', path: objectPath(ownerId, blobId) });
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
}

let healthCheckedAt = 0;
let healthy = false;

export async function storageHealthy(): Promise<boolean> {
  const now = Date.now();
  if (now - healthCheckedAt < 1000) return healthy;
  healthy = await storageReachable();
  healthCheckedAt = now;
  return healthy;
}
