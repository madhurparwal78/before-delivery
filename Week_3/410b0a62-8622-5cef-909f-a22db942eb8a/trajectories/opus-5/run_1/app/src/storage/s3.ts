import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export class StorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Object storage is unreachable');
    this.name = 'StorageUnavailableError';
    this.cause = cause;
  }
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  path: string;
  body?: Buffer;
  headers?: Record<string, string>;
}

function signedFetchArgs(request: SignedRequest): { url: string; init: RequestInit } {
  const endpoint = new URL(config.s3.endpoint);
  const url = new URL(endpoint.toString().replace(/\/$/, '') + request.path);
  const payloadHash = request.body ? sha256Hex(request.body) : EMPTY_SHA256;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(
      Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    ),
  };

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${(headers[name] as string).trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [
    request.method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const init: RequestInit = {
    method: request.method,
    headers,
    signal: AbortSignal.timeout(config.uploadTimeoutMs),
  };
  if (request.body) init.body = new Uint8Array(request.body);
  return { url: url.toString(), init };
}

async function send(request: SignedRequest): Promise<Response> {
  const { url, init } = signedFetchArgs(request);
  try {
    return await fetch(url, init);
  } catch (cause) {
    throw new StorageUnavailableError(cause);
  }
}

function objectPath(key: string): string {
  return config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${encodeKeyPath(key)}`
    : `/${encodeKeyPath(key)}`;
}

export interface StoredObjectHead {
  size: number;
  sha256: string;
  contentType: string;
  filename: string;
}

export async function ensureBucket(): Promise<void> {
  const head = await send({ method: 'HEAD', path: `/${config.s3.bucket}` });
  if (head.ok) return;
  const created = await send({ method: 'PUT', path: `/${config.s3.bucket}`, body: Buffer.alloc(0) });
  if (!created.ok && created.status !== 409) throw new StorageUnavailableError(created.status);
}

export async function putActivityObject(args: {
  key: string;
  body: Buffer;
  contentType: string;
  sha256: string;
  filename: string;
}): Promise<void> {
  const response = await send({
    method: 'PUT',
    path: objectPath(args.key),
    body: args.body,
    headers: {
      'content-type': args.contentType,
      'x-amz-meta-sha256': args.sha256,
      'x-amz-meta-filename': encodeURIComponent(args.filename),
    },
  });
  if (!response.ok) throw new StorageUnavailableError(response.status);
}

export async function headActivityObject(key: string): Promise<StoredObjectHead> {
  const response = await send({ method: 'HEAD', path: objectPath(key) });
  if (!response.ok) throw new StorageUnavailableError(response.status);
  return {
    size: Number(response.headers.get('content-length') ?? '0'),
    sha256: response.headers.get('x-amz-meta-sha256') ?? '',
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    filename: decodeURIComponent(response.headers.get('x-amz-meta-filename') ?? ''),
  };
}

export async function getActivityObject(key: string): Promise<{ body: Buffer; contentType: string }> {
  const response = await send({ method: 'GET', path: objectPath(key) });
  if (!response.ok) throw new StorageUnavailableError(response.status);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function deleteActivityObject(key: string): Promise<void> {
  const response = await send({ method: 'DELETE', path: objectPath(key) });
  if (!response.ok && response.status !== 404) throw new StorageUnavailableError(response.status);
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send({ method: 'HEAD', path: `/${config.s3.bucket}` });
    return response.ok;
  } catch {
    return false;
  }
}

export function activityObjectKey(athleteId: string, workoutId: string, extension: string): string {
  return `activities/${athleteId}/${workoutId}.${extension}`;
}
