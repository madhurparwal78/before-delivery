import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { imageStoreUnavailable } from '../errors.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 5_000;

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

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(key: string): string {
  const segments = [config.s3.bucket, ...key.split('/')];
  return `/${segments.map(encodeSegment).join('/')}`;
}

function signingKey(date: string): Buffer {
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function endpointHost(): string {
  return new URL(config.s3.endpoint).host;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  path: string,
  payload: Buffer,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host: endpointHost(),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${String(headers[name] ?? '').trim()}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(date), stringToSign).toString('hex');
  return {
    url: `${config.s3.endpoint}${path}`,
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function send(
  method: string,
  path: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, path, payload, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' && payload.length > 0 ? new Uint8Array(payload) : null,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw imageStoreUnavailable();
  }
}

let bucketReady = false;

/** Confirms the store answers and the bucket exists, so outages fail loudly. */
export async function assertPictureStoreReady(): Promise<void> {
  if (bucketReady) return;
  const path = `/${encodeSegment(config.s3.bucket)}`;
  const head = await send('HEAD', path, Buffer.alloc(0));
  if (head.ok) {
    bucketReady = true;
    return;
  }
  const created = await send('PUT', path, Buffer.alloc(0));
  if (!created.ok && created.status !== 409) throw imageStoreUnavailable();
  bucketReady = true;
}

export interface StoredObject {
  bytes: number;
  contentType: string;
}

export async function putPicture(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<StoredObject> {
  await assertPictureStoreReady();
  const written = await send('PUT', canonicalPath(key), body, { 'content-type': contentType });
  if (!written.ok) throw imageStoreUnavailable();
  const stat = await send('HEAD', canonicalPath(key), Buffer.alloc(0));
  if (!stat.ok) throw imageStoreUnavailable();
  const length = Number(stat.headers.get('content-length'));
  if (!Number.isFinite(length)) throw imageStoreUnavailable();
  return {
    bytes: length,
    contentType: stat.headers.get('content-type') ?? contentType,
  };
}

export function presignPictureUrl(key: string): string {
  const { stamp, date } = amzDate(new Date());
  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const path = canonicalPath(key);
  const params: [string, string][] = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${config.s3.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(config.imageUrlTtlSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const canonicalQuery = params
    .map(([name, value]) => `${encodeSegment(name)}=${encodeSegment(value)}`)
    .sort()
    .join('&');
  const canonicalRequest = [
    'GET',
    path,
    canonicalQuery,
    `host:${endpointHost()}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(date), stringToSign).toString('hex');
  return `${config.s3.endpoint}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function pictureKey(questionId: string, bytes: Buffer, extension: string): string {
  return `questions/${questionId}/${sha256Hex(bytes)}.${extension}`;
}
