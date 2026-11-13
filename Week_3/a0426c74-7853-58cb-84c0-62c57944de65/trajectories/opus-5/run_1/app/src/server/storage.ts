import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

let forcedDown = false;

export function setStorageDown(down: boolean): void {
  forcedDown = down;
}

export function storageIsForcedDown(): boolean {
  return forcedDown;
}

export class StorageUnavailable extends Error {}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
  return { stamp, date: stamp.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(method: string, key: string, body: Buffer | null): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const path = key === ''
    ? `/${config.s3.bucket}`
    : config.s3.forcePathStyle
      ? `/${config.s3.bucket}/${key}`
      : `/${key}`;
  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(body ?? '');
  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const canonicalPath = path
    .split('/')
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join('/');
  const canonicalRequest = [
    method,
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaderNames.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;
  return { url: `${endpoint.origin}${path}`, headers };
}

async function send(method: string, key: string, body: Buffer | null, timeoutMs = 5000): Promise<Response> {
  if (forcedDown) throw new StorageUnavailable('storage down');
  const signed = signRequest(method, key, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body ?? undefined,
      signal: controller.signal,
    });
    return response;
  } catch {
    throw new StorageUnavailable('storage unreachable');
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  const response = await send('PUT', key, body);
  if (!response.ok) throw new StorageUnavailable(`put failed: ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send('GET', key, null);
  if (!response.ok) throw new StorageUnavailable(`get failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', key, null);
  return response.ok;
}

export async function storageHealthy(): Promise<boolean> {
  if (forcedDown) return false;
  try {
    const endpoint = new URL(config.s3.endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`${endpoint.origin}/minio/health/live`, { signal: controller.signal });
      if (response.ok) return true;
    } finally {
      clearTimeout(timer);
    }
    const bucket = await send('HEAD', '', null, 2000);
    return bucket.ok;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    const head = await send('HEAD', '', null, 2000);
    if (head.ok) return;
    await send('PUT', '', Buffer.alloc(0), 2000);
  } catch {
    return;
  }
}

export function sha256Of(body: Buffer): string {
  return sha256Hex(body);
}
