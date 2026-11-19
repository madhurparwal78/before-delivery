import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

export class StorageUnavailable extends Error {
  constructor() {
    super('storage_unavailable');
  }
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function objectPath(key: string): string {
  const prefix = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '';
  return `${prefix}/${encodePath(key)}`;
}

async function request(
  method: string,
  path: string,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 2500,
): Promise<Response> {
  const base = new URL(config.s3.endpoint);
  const host = config.s3.forcePathStyle ? base.host : `${config.s3.bucket}.${base.host}`;
  const url = new URL(`${base.protocol}//${host}${path}`);
  const stamp = new Date(Date.now()).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(extraHeaders)) headers[k.toLowerCase()] = v;
  headers['host'] = host;
  headers['x-amz-content-sha256'] = payloadHash;
  headers['x-amz-date'] = stamp;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new StorageUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const res = await request('PUT', objectPath(key), body, { 'content-type': contentType });
  if (!res.ok) throw new StorageUnavailable();
}

export async function headObject(key: string): Promise<boolean> {
  const res = await request('HEAD', objectPath(key), null);
  if (res.status === 404) return false;
  if (!res.ok) throw new StorageUnavailable();
  return true;
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await request('GET', objectPath(key), null);
  if (!res.ok) throw new StorageUnavailable();
  return Buffer.from(await res.arrayBuffer());
}

export async function ensureBucket(): Promise<void> {
  const bucketPath = `/${config.s3.bucket}`;
  const res = await request('HEAD', bucketPath, null);
  if (res.status === 404) await request('PUT', bucketPath, null);
}

export async function storageReachable(): Promise<boolean> {
  try {
    const res = await request('HEAD', `/${config.s3.bucket}`, null, {}, 2000);
    return res.status < 500;
  } catch {
    return false;
  }
}
