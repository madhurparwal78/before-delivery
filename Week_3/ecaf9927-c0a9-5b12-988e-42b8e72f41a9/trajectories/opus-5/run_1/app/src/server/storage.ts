import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
export const STORAGE_TIMEOUT_MS = 5000;
const STATUS_CACHE_MS = 5000;

function sha256Hex(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
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
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

type SignedRequest = { url: string; headers: Record<string, string> };

function sign(
  method: string,
  path: string,
  query: string,
  payload: Buffer,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const base = new URL(config.storage.endpoint);
  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${(headers[name] as string).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.storage.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${config.storage.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, config.storage.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `${ALGORITHM} Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${base.origin}${path}${query === '' ? '' : `?${query}`}`, headers };
}

function objectPath(key: string): string {
  return config.storage.forcePathStyle
    ? `/${encodeURIComponent(config.storage.bucket)}/${encodePath(key)}`
    : `/${encodePath(key)}`;
}

export type PutOutcome = 'written' | 'refused';

export async function putBodyObject(key: string, json: string): Promise<PutOutcome> {
  const payload = Buffer.from(json, 'utf8');
  const request = sign('PUT', objectPath(key), '', payload, {
    'content-type': 'application/json',
  });
  try {
    const response = await fetch(request.url, {
      method: 'PUT',
      headers: request.headers,
      body: payload,
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    });
    return response.ok ? 'written' : 'refused';
  } catch {
    return 'refused';
  }
}

export async function getBodyObject(key: string): Promise<Buffer | null> {
  const request = sign('GET', objectPath(key), '', Buffer.alloc(0), {});
  const response = await fetch(request.url, {
    method: 'GET',
    headers: request.headers,
    signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

let cachedStatus: { at: number; reachable: boolean } | null = null;

async function probeStorage(): Promise<boolean> {
  const path = config.storage.forcePathStyle
    ? `/${encodeURIComponent(config.storage.bucket)}`
    : '/';
  const request = sign('GET', path, 'list-type=2&max-keys=0', Buffer.alloc(0), {});
  try {
    const response = await fetch(request.url, {
      method: 'GET',
      headers: request.headers,
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Storage reachability, re-probed when the last answer is older than five seconds. */
export async function storageReachable(): Promise<boolean> {
  if (cachedStatus && Date.now() - cachedStatus.at < STATUS_CACHE_MS) return cachedStatus.reachable;
  const reachable = await probeStorage();
  cachedStatus = { at: Date.now(), reachable };
  return reachable;
}

export function noteStorageOutcome(outcome: PutOutcome): void {
  cachedStatus = { at: Date.now(), reachable: outcome === 'written' };
}
