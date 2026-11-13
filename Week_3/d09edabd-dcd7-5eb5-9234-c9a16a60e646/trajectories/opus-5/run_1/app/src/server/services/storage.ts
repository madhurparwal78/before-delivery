import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { errors } from '../errors.js';

interface SignedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Buffer;
}

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

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function sign(method: string, key: string, body: Buffer, extra: Record<string, string>): SignedRequest {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const path = forcePathStyle
    ? `/${bucket}${key ? `/${encodeKey(key)}` : ''}`
    : `${key ? `/${encodeKey(key)}` : '/'}`;
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extra,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = forcePathStyle
    ? `${base.protocol}//${base.host}${path}`
    : `${base.protocol}//${host}${path}`;
  return { method, url, headers, body };
}

let reachable = false;

export function minioUp(): boolean {
  return reachable;
}

async function call(
  method: string,
  key: string,
  body: Buffer,
  extra: Record<string, string> = {},
): Promise<Response> {
  const request = sign(method, key, body, extra);
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
    signal: AbortSignal.timeout(4000),
  });
  reachable = true;
  return response;
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    reachable = false;
    throw errors.storageUnavailable();
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await guarded(() =>
    call('PUT', key, body, {
      'content-type': contentType,
      'content-length': String(body.length),
    }),
  );
  if (!response.ok) {
    reachable = response.status < 500;
    throw errors.storageUnavailable();
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await guarded(() => call('GET', key, Buffer.alloc(0)));
  if (response.status === 404) return null;
  if (!response.ok) {
    reachable = response.status < 500;
    throw errors.storageUnavailable();
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await guarded(() => call('DELETE', key, Buffer.alloc(0)));
  if (!response.ok && response.status !== 404) {
    reachable = response.status < 500;
    throw errors.storageUnavailable();
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    const head = await call('HEAD', '', Buffer.alloc(0));
    if (head.status === 404) {
      await call('PUT', '', Buffer.alloc(0), { 'content-length': '0' });
    }
    reachable = true;
  } catch {
    reachable = false;
  }
}

export async function pingStorage(): Promise<void> {
  try {
    const head = await call('HEAD', '', Buffer.alloc(0));
    reachable = head.status < 500;
    if (head.status === 404) await ensureBucket();
  } catch {
    reachable = false;
  }
}
