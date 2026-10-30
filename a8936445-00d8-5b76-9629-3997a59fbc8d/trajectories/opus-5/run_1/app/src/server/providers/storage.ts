import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageUnavailableError extends Error {
  constructor(cause: string) {
    super(`Object storage unavailable: ${cause}`);
    this.name = 'StorageUnavailableError';
  }
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
  size: number;
}

const SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; dateOnly: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, dateOnly: stamp.slice(0, 8) };
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function objectUrl(key: string): URL {
  const base = new URL(config.storage.endpoint);
  const path = config.storage.forcePathStyle
    ? `/${config.storage.bucket}${key ? `/${encodeKey(key)}` : ''}`
    : `/${encodeKey(key)}`;
  const url = new URL(base.toString());
  url.pathname = path;
  return url;
}

interface SignedRequest {
  method: string;
  url: URL;
  payload: Buffer;
  contentType?: string;
}

function signedHeaders(request: SignedRequest): Record<string, string> {
  const now = new Date();
  const { stamp, dateOnly } = amzDate(now);
  const payloadHash =
    request.payload.length === 0 ? EMPTY_SHA256 : createHash('sha256').update(request.payload).digest('hex');
  const headers: Record<string, string> = {
    host: request.url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (request.contentType) headers['content-type'] = request.contentType;

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaderList = sortedNames.join(';');
  const canonicalRequest = [
    request.method,
    request.url.pathname,
    request.url.searchParams.toString(),
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');

  const scope = `${dateOnly}/${config.storage.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const dateKey = hmac(`AWS4${config.storage.secretAccessKey}`, dateOnly);
  const regionKey = hmac(dateKey, config.storage.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope},` +
    ` SignedHeaders=${signedHeaderList}, Signature=${signature}`;
  return headers;
}

async function send(request: SignedRequest): Promise<Response> {
  const headers = signedHeaders(request);
  const init: RequestInit = {
    method: request.method,
    headers,
    signal: AbortSignal.timeout(10_000),
  };
  if (request.payload.length > 0) init.body = request.payload;
  try {
    return await fetch(request.url, init);
  } catch (error) {
    throw new StorageUnavailableError(error instanceof Error ? error.message : 'request failed');
  }
}

export async function ensureBucket(): Promise<void> {
  const url = objectUrl('');
  const head = await send({ method: 'HEAD', url, payload: Buffer.alloc(0) });
  if (head.status === 200) return;
  if (head.status !== 404) throw new StorageUnavailableError(`bucket check ${head.status}`);
  const created = await send({ method: 'PUT', url, payload: Buffer.alloc(0) });
  if (created.status >= 500) throw new StorageUnavailableError(`bucket create ${created.status}`);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send({ method: 'PUT', url: objectUrl(key), payload: body, contentType });
  if (!response.ok) throw new StorageUnavailableError(`put ${response.status}`);
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const response = await send({ method: 'GET', url: objectUrl(key), payload: Buffer.alloc(0) });
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailableError(`get ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    body: buffer,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    size: buffer.length,
  };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send({ method: 'DELETE', url: objectUrl(key), payload: Buffer.alloc(0) });
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
    throw new StorageUnavailableError(`delete ${response.status}`);
  }
}
