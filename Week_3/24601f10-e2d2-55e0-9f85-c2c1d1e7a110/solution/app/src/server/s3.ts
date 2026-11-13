import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { fail } from './errors.js';
import { MSG } from './messages.js';

// A small SigV4 client over fetch: the app needs only put, get and a reachability probe.
const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function send(method: 'GET' | 'PUT' | 'HEAD', key: string, body: Buffer = Buffer.alloc(0),
  contentType?: string, timeoutMs = 5000): Promise<Response> {
  const base = new URL(endpoint);
  const objectPath = key ? `/${key.split('/').map(encodeSegment).join('/')}` : '';
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}${objectPath}` : objectPath || '/';
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body);
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = [method, path, '', `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`,
    signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = hmac(signingKey, toSign).toString('hex');
  const headers: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) headers['content-type'] = contentType;
  const url = `${base.protocol}//${host}${path}`;
  return fetch(url, { method, headers, body: method === 'PUT' ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs) });
}

async function createBucketIfMissing(): Promise<boolean> {
  const made = await send('PUT', '');
  return made.ok || made.status === 409;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    let response = await send('PUT', key, body, contentType);
    if (response.status === 404 && await createBucketIfMissing()) response = await send('PUT', key, body, contentType);
    if (!response.ok) throw new Error(`PUT ${response.status}`);
  } catch {
    fail('storage_unavailable', MSG.storageDown);
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    const response = await send('GET', key);
    if (!response.ok) throw new Error(`GET ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return fail('storage_unavailable', MSG.storageDown);
  }
}

// Health: storage reachability is measured at most HEALTH_TTL_MS before the answer, never longer than 5 seconds.
const HEALTH_TTL_MS = 2000;
let checkedAt = 0;
let lastResult = false;
let inFlight: Promise<boolean> | null = null;

async function probe(): Promise<boolean> {
  try {
    const head = await send('HEAD', '', Buffer.alloc(0), undefined, 2500);
    if (head.ok) return true;
    return head.status === 404 && await createBucketIfMissing();
  } catch {
    return false;
  }
}

export async function storageReachable(): Promise<boolean> {
  if (Date.now() - checkedAt < HEALTH_TTL_MS) return lastResult;
  inFlight ??= probe().then((ok) => {
    lastResult = ok;
    checkedAt = Date.now();
    inFlight = null;
    return ok;
  });
  return inFlight;
}
