import { createHash, createHmac } from 'node:crypto';
import { config } from './config';

export class StorageError extends Error {}

const { s3 } = config;
const EMPTY_HASH = createHash('sha256').update('').digest('hex');
const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function objectUrl(key: string): URL {
  const base = s3.endpoint.replace(/\/$/, '');
  const path = key === '' ? '' : '/' + key.split('/').map(encodeSegment).join('/');
  return new URL(`${base}/${s3.bucket}${path}`);
}

async function request(method: string, key: string, body?: Buffer, query = ''): Promise<Response> {
  const url = objectUrl(key);
  if (query) url.search = query;
  const payload = body ? sha256(body) : EMPTY_HASH;
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': stamp };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join('');
  const canonical = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payload].join('\n');
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signingKey = ['s3', 'aws4_request'].reduce((key2, part) => hmac(key2, part), hmac(hmac(`AWS4${s3.secretAccessKey}`, day), s3.region));
  const authorization = `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, toSign).toString('hex')}`;
  try {
    return await fetch(url, {
      method,
      headers: { 'x-amz-content-sha256': payload, 'x-amz-date': stamp, authorization },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new StorageError('object store unreachable');
  }
}

/** Stores an object, then asks the store for its size and checksum; the object is deleted unless both match. */
export async function putConfirmed(key: string, data: Buffer): Promise<void> {
  const response = await request('PUT', key, data);
  if (!response.ok) throw new StorageError(`store refused ${key}: ${response.status}`);
  const head = await request('HEAD', key);
  const etag = (head.headers.get('etag') ?? '').replace(/"/g, '');
  const md5 = createHash('md5').update(data).digest('hex');
  if (!head.ok || Number(head.headers.get('content-length')) !== data.length || etag !== md5) {
    await deleteObject(key);
    throw new StorageError(`store did not confirm ${key}`);
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await request('GET', key);
  if (!response.ok) throw new StorageError(`store could not read ${key}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  await request('DELETE', key).catch(() => undefined);
}

let reachableUntil = 0;
let reachableValue = false;

/** True when the object store answers; the answer is reused for a second. */
export async function storageReachable(): Promise<boolean> {
  if (Date.now() < reachableUntil) return reachableValue;
  try {
    const response = await request('HEAD', '');
    reachableValue = response.status < 500;
  } catch {
    reachableValue = false;
  }
  reachableUntil = Date.now() + 1000;
  return reachableValue;
}

/** Makes the bucket when the store answers but has none. */
export async function ensureBucket(): Promise<void> {
  try {
    const head = await request('HEAD', '');
    if (head.status === 404) await request('PUT', '');
  } catch {
    // The store may be down at start; exports and imports report it when asked.
  }
}
