import { createHash, createHmac } from 'node:crypto';
import { config } from '../core/config.js';

const REQUEST_TIMEOUT_MS = 3000;
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export class StorageUnreachable extends Error {
  constructor() {
    super('Object storage is unreachable');
    this.name = 'StorageUnreachable';
  }
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function uriEncodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, objectKey: string | null, payload: Uint8Array | null, extra: Record<string, string>): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const pathStyle = config.s3.forcePathStyle || /^[0-9.]+$/.test(endpoint.hostname);
  const host = pathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const path = pathStyle
    ? `/${config.s3.bucket}${objectKey ? `/${uriEncodeKey(objectKey)}` : ''}`
    : `/${objectKey ? uriEncodeKey(objectKey) : ''}`;

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = payload ? createHash('sha256').update(payload).digest('hex') : EMPTY_SHA256;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extra,
  };

  const signedHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${endpoint.origin}${path}`, headers };
}

async function send(
  method: string,
  objectKey: string | null,
  payload: Uint8Array | null,
  extra: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, objectKey, payload, extra);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload ? Buffer.from(payload) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnreachable();
  }
}

export async function putObject(objectKey: string, body: Uint8Array, contentType: string): Promise<void> {
  const response = await send('PUT', objectKey, body, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
  });
  if (!response.ok) throw new StorageUnreachable();
  await response.arrayBuffer();
}

export async function headObject(objectKey: string): Promise<boolean> {
  const response = await send('HEAD', objectKey, null);
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageUnreachable();
  return true;
}

export async function getObject(objectKey: string): Promise<Buffer | null> {
  const response = await send('GET', objectKey, null);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnreachable();
  return Buffer.from(await response.arrayBuffer());
}

/** Creates the bucket when it is missing, so a fresh MinIO works without manual setup. */
export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', null, null);
  if (head.ok) {
    await head.arrayBuffer();
    return;
  }
  const created = await send('PUT', null, new Uint8Array(0), { 'content-length': '0' });
  await created.arrayBuffer();
}

export async function storageAvailable(): Promise<boolean> {
  try {
    const response = await send('HEAD', null, null);
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
