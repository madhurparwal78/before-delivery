import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

/**
 * A small S3 client, signed with Signature Version 4, for the private photo
 * bucket. Photos reach browsers only through the app's own endpoints.
 */
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export class StorageUnavailable extends Error {
  constructor() {
    super('storage unavailable');
  }
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeSegment(segment))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, pathname: string, queryEntries: [string, string][], payload: Buffer | null): SignedRequest {
  const endpoint = new URL(config.storage.endpoint);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = payload === null ? EMPTY_SHA256 : createHash('sha256').update(payload).digest('hex');
  const host = endpoint.host;

  const canonicalQuery = queryEntries
    .map(([key, value]) => [encodeSegment(key), encodeSegment(value)] as [string, string])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join('');

  const canonicalRequest = [
    method,
    canonicalPath(pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.storage.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, dateStamp), config.storage.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpoint.origin}${canonicalPath(pathname)}${canonicalQuery === '' ? '' : `?${canonicalQuery}`}`;
  return { url, headers };
}

function objectPath(key: string): string {
  return config.storage.forcePathStyle ? `/${config.storage.bucket}/${key}` : `/${key}`;
}

async function call(
  method: string,
  pathname: string,
  queryEntries: [string, string][],
  payload: Buffer | null,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const signed = sign(method, pathname, queryEntries, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(signed.url, {
      method,
      headers: { ...signed.headers, ...extraHeaders },
      body: payload === null ? undefined : new Uint8Array(payload),
      signal: controller.signal,
    });
  } catch {
    throw new StorageUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await call('PUT', objectPath(key), [], body, { 'content-type': contentType });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnavailable();
  }
  await response.arrayBuffer().catch(() => undefined);
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const response = await call('GET', objectPath(key), [], null);
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnavailable();
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { body: buffer, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call('DELETE', objectPath(key), [], null);
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok && response.status !== 404) throw new StorageUnavailable();
}

export async function storageReachable(): Promise<boolean> {
  try {
    const pathname = config.storage.forcePathStyle ? `/${config.storage.bucket}` : '/';
    const response = await call('HEAD', pathname, [], null, {}, 5_000);
    await response.arrayBuffer().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const pathname = config.storage.forcePathStyle ? `/${config.storage.bucket}` : '/';
  const head = await call('HEAD', pathname, [], null, {}, 5_000);
  await head.arrayBuffer().catch(() => undefined);
  if (head.ok) return;
  const created = await call('PUT', pathname, [], Buffer.alloc(0), {}, 5_000);
  await created.arrayBuffer().catch(() => undefined);
}
