import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

export class StorageUnavailable extends Error {
  constructor() {
    super('storage_unavailable');
  }
}

let forcedDown = false;

export function setStorageDown(down: boolean): void {
  forcedDown = down;
}


function hash(body: Uint8Array | string): string {
  return createHash('sha256').update(body).digest('hex');
}

export function sha256Hex(body: Uint8Array): string {
  return hash(body);
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(d: Date): { full: string; short: string } {
  const full = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { full, short: full.slice(0, 8) };
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function request(
  method: string,
  key: string,
  body: Uint8Array | undefined,
  contentType?: string,
): Promise<Response> {
  if (forcedDown) throw new StorageUnavailable();
  const { endpoint, bucket, region, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const path = forcePathStyle
    ? `/${encodePath(bucket)}${key === '' ? '' : `/${encodePath(key)}`}`
    : `/${encodePath(key)}`;
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const url = `${base.protocol}//${base.host}${path}`;

  const payload = body ?? new Uint8Array(0);
  const payloadHash = hash(payload);
  const d = amzDate(new Date());

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': d.full,
  };
  if (contentType !== undefined) headers['content-type'] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h].trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${d.short}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', d.full, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, d.short), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers['authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') init.body = body;
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  } catch {
    throw new StorageUnavailable();
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const res = await request('PUT', key, body, contentType);
  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined);
    throw new StorageUnavailable();
  }
  await res.arrayBuffer().catch(() => undefined);
}

export async function getObject(key: string): Promise<Uint8Array> {
  const res = await request('GET', key, undefined);
  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined);
    throw new StorageUnavailable();
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function storageHealthy(): Promise<boolean> {
  if (forcedDown) return false;
  try {
    const res = await request('HEAD', '', undefined);
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    const head = await request('HEAD', '', undefined);
    await head.arrayBuffer().catch(() => undefined);
    if (head.status === 404) {
      const made = await request('PUT', '', new Uint8Array(0));
      await made.arrayBuffer().catch(() => undefined);
    }
  } catch {
    /* storage is unreachable at boot; each operation retries afresh */
  }
}
