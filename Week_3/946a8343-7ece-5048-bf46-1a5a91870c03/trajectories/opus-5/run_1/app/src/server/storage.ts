import { createHash, createHmac } from 'node:crypto';
import { config } from './config';

let forcedDown = false;

export function setStorageDown(down: boolean): void {
  forcedDown = down;
}

export function storageForcedDown(): boolean {
  return forcedDown;
}

export class StorageUnavailable extends Error {
  constructor() {
    super('file storage is unavailable');
  }
}

function hex(value: Buffer | string): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function amzDate(): { stamp: string; date: string } {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { stamp: iso, date: iso.slice(0, 8) };
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function signedFetch(method: string, canonicalUri: string, body?: Buffer): Promise<Response> {
  if (forcedDown) throw new StorageUnavailable();
  const url = new URL(config.s3.endpoint);
  const host = url.host;
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = hex(payload);
  const { stamp, date } = amzDate();
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join('');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(`${url.origin}${canonicalUri}`, {
      method,
      headers: { ...headers, authorization: authorization },
      body: method === 'PUT' ? payload : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new StorageUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

function objectUri(key: string): string {
  return config.s3.pathStyle ? `/${config.s3.bucket}/${encodePath(key)}` : `/${encodePath(key)}`;
}

function bucketUri(): string {
  return config.s3.pathStyle ? `/${config.s3.bucket}` : '/';
}

export async function putObject(key: string, body: string | Buffer): Promise<void> {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const response = await signedFetch('PUT', objectUri(key), payload);
  if (!response.ok) throw new StorageUnavailable();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await signedFetch('GET', objectUri(key));
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

export async function headObject(key: string): Promise<boolean> {
  const response = await signedFetch('HEAD', objectUri(key));
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageUnavailable();
  return true;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await signedFetch('DELETE', objectUri(key));
  if (!response.ok && response.status !== 404) throw new StorageUnavailable();
}

export async function ensureBucket(): Promise<void> {
  try {
    const head = await signedFetch('HEAD', bucketUri());
    if (head.status === 404) await signedFetch('PUT', bucketUri());
  } catch {
    // creating the bucket is best effort; the health route reports an outage
  }
}

export async function storageReachable(): Promise<boolean> {
  if (forcedDown) return false;
  try {
    const response = await signedFetch('HEAD', bucketUri());
    return response.status < 500;
  } catch {
    return false;
  }
}
