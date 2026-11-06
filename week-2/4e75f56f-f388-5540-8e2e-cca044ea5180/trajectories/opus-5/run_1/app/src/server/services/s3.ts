import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageUnavailable extends Error {
  constructor(detail: string) {
    super(`MinIO is not answering: ${detail}`);
    this.name = 'StorageUnavailable';
  }
}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const REQUEST_TIMEOUT_MS = 6_000;

const endpoint = new URL(config.s3.endpoint);

function sha256Hex(payload: string | Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function amzTimestamps(at: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${at.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(dateStamp: string): Buffer {
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function objectPath(key: string | null): string {
  const segments = key === null ? [] : key.split('/').map(encodeSegment);
  const bucketPath = config.s3.forcePathStyle ? `/${encodeSegment(config.s3.bucket)}` : '';
  return segments.length === 0 ? `${bucketPath}/` : `${bucketPath}/${segments.join('/')}`;
}

function objectHost(): string {
  return config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signWithHeaders(
  method: string,
  path: string,
  payload: Uint8Array,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const { amzDate, dateStamp } = amzTimestamps(new Date());
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host: objectHost(),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => {
      const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
      return `${name}:${value.trim()}\n`;
    })
    .join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(dateStamp), stringToSign).toString('hex');
  headers['authorization'] =
    `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.protocol}//${objectHost()}${path}`, headers };
}

async function send(
  method: string,
  path: string,
  payload: Uint8Array,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signWithHeaders(method, path, payload, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : payload,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageUnavailable(error instanceof Error ? error.message : 'request failed');
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', objectPath(null), new Uint8Array());
  if (head.ok) return;
  const created = await send('PUT', objectPath(null), new Uint8Array());
  if (!created.ok && created.status !== 409) {
    throw new StorageUnavailable(`bucket create answered ${created.status}`);
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const response = await send('PUT', objectPath(key), body, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
  });
  if (!response.ok) {
    throw new StorageUnavailable(`put answered ${response.status}`);
  }
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', objectPath(key), new Uint8Array());
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(`delete answered ${response.status}`);
  }
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', objectPath(key), new Uint8Array());
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageUnavailable(`head answered ${response.status}`);
  return true;
}

/** A link the browser may use for `expiresIn` seconds and no longer. */
export function presignGet(key: string, expiresIn: number): string {
  const { amzDate, dateStamp } = amzTimestamps(new Date());
  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const query = new URLSearchParams({
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${config.s3.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  });
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = objectPath(key);
  const canonicalRequest = [
    'GET',
    path,
    canonicalQuery,
    `host:${objectHost()}\n`,
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n');
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(dateStamp), stringToSign).toString('hex');
  return `${endpoint.protocol}//${objectHost()}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
