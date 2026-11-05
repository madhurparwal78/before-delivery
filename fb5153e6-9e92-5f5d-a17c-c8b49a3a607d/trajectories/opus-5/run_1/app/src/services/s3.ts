import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

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

/** Each path segment is encoded, leaving `/` as the separator. */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function sign(
  method: string,
  objectKey: string | null,
  payload: Buffer | null,
  extraHeaders: Readonly<Record<string, string>> = {},
): SignedRequest {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const path = forcePathStyle
    ? `/${bucket}${objectKey === null ? '' : `/${encodeKey(objectKey)}`}`
    : `${objectKey === null ? '/' : `/${encodeKey(objectKey)}`}`;
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;

  const { stamp, date } = amzDate(new Date());
  const payloadHash = payload === null ? EMPTY_SHA256 : sha256Hex(payload);

  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${(headers[n] ?? '').trim()}\n`).join('');
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
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${base.protocol}//${base.host}${path}`, headers };
}

/** Thrown when object storage is unreachable or answers an error. */
export class StorageError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
  }
}

async function request(
  method: string,
  objectKey: string | null,
  payload: Buffer | null,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const headers = { ...extraHeaders };
  if (payload !== null) headers['content-length'] = String(payload.length);
  const signed = sign(method, objectKey, payload, headers);
  const init: RequestInit = {
    method,
    headers: signed.headers,
    signal: AbortSignal.timeout(30_000),
  };
  if (payload !== null) init.body = new Uint8Array(payload);
  try {
    return await fetch(signed.url, init);
  } catch (error) {
    throw new StorageError(`Object storage is unreachable: ${String(error)}`, 503);
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await request('HEAD', null, null);
  if (head.ok) return;
  const created = await request('PUT', null, Buffer.alloc(0));
  if (!created.ok && created.status !== 409) {
    throw new StorageError(`Bucket could not be created (${created.status})`, created.status);
  }
}

/** Stores an object. Objects are never overwritten or recompressed. */
export async function putObject(
  objectKey: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const response = await request('PUT', objectKey, bytes, { 'content-type': contentType });
  if (!response.ok) {
    throw new StorageError(`Object write failed (${response.status})`, response.status);
  }
  await response.arrayBuffer();
}

export async function getObject(objectKey: string): Promise<Buffer | null> {
  const response = await request('GET', objectKey, null);
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    throw new StorageError(`Object read failed (${response.status})`, response.status);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** The byte length the object reads back with, used to confirm a write. */
export async function objectLength(objectKey: string): Promise<number | null> {
  const response = await request('HEAD', objectKey, null);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new StorageError(`Object head failed (${response.status})`, response.status);
  }
  const length = response.headers.get('content-length');
  return length === null ? null : Number.parseInt(length, 10);
}

export async function storageUp(): Promise<boolean> {
  try {
    const response = await request('HEAD', null, null);
    await response.arrayBuffer().catch(() => undefined);
    return response.ok || response.status === 403 || response.status === 404;
  } catch {
    return false;
  }
}

export const objectKeys = {
  original: (sha256: string): string => `originals/${sha256}`,
  derivative: (slug: string, revision: number, file: 'model.glb' | 'model.stl' | 'preview.png'): string =>
    `derivatives/${slug}/r${revision}/${file}`,
  textureSet: (sha256: string): string => `texture-sets/${sha256}`,
};
