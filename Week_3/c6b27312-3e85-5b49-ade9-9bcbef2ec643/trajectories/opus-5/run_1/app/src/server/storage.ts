import { createHash, createHmac } from 'node:crypto';
import { config } from './config';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

type S3Response = { status: number; body: Buffer; headers: Headers };

async function send(
  method: 'GET' | 'PUT' | 'HEAD',
  key: string,
  body: Buffer | null,
  contentType?: string,
): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${key ? `/${encodeKeyPath(key)}` : ''}`
    : `/${encodeKeyPath(key)}`;
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = body ? sha256Hex(payload) : EMPTY_SHA256;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const host = endpoint.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join('');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`${endpoint.origin}${path}`, {
    method,
    headers,
    body: method === 'PUT' ? payload : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const buffer = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
  return { status: response.status, body: buffer, headers: response.headers };
}

export class StorageUnavailable extends Error {
  constructor() {
    super('storage_unavailable');
  }
}

let lastFailureAt = 0;
let lastSuccessAt = 0;

function noteFailure(): void {
  lastFailureAt = Date.now();
}

function noteSuccess(): void {
  lastSuccessAt = Date.now();
}

async function request(
  method: 'GET' | 'PUT' | 'HEAD',
  key: string,
  body: Buffer | null,
  contentType?: string,
): Promise<S3Response> {
  try {
    const response = await send(method, key, body, contentType);
    if (response.status >= 500) {
      noteFailure();
      throw new StorageUnavailable();
    }
    noteSuccess();
    return response;
  } catch (error) {
    if (error instanceof StorageUnavailable) throw error;
    noteFailure();
    throw new StorageUnavailable();
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await request('PUT', key, body, contentType);
  if (response.status >= 400) throw new StorageUnavailable();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await request('GET', key, null);
  if (response.status === 404) return null;
  if (response.status >= 400) throw new StorageUnavailable();
  return response.body;
}

/** Reads an object's metadata back, to confirm it is present. */
export async function headObject(key: string): Promise<{ size: number } | null> {
  const response = await request('HEAD', key, null);
  if (response.status === 404) return null;
  if (response.status >= 400) throw new StorageUnavailable();
  return { size: Number(response.headers.get('content-length') ?? '0') };
}

export async function storageReachable(): Promise<boolean> {
  try {
    await request('HEAD', '', null);
    return true;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const probe = await send('HEAD', '', null).catch(() => null);
  if (probe && probe.status === 200) {
    noteSuccess();
    return;
  }
  if (!probe) {
    noteFailure();
    return;
  }
  await send('PUT', '', Buffer.alloc(0)).catch(() => null);
}

export function lastKnownStorageState(): 'up' | 'down' | 'unknown' {
  if (lastFailureAt === 0 && lastSuccessAt === 0) return 'unknown';
  return lastFailureAt > lastSuccessAt ? 'down' : 'up';
}

export const storageKeys = {
  solid: (digest: string) => `solids/${digest}.json`,
  thumbnail: (digest: string) => `thumbnails/${digest}.svg`,
  source: (sha: string) => `sources/${sha}.tine`,
  archive: (revisionId: string, format: 'zip' | 'tar') => `archives/${revisionId}.${format}`,
};
