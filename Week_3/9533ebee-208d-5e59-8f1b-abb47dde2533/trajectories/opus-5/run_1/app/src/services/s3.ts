/**
 * Object storage for settlement statements, statement PDFs and price
 * evidence. Requests are signed with AWS Signature Version 4 directly, so a
 * connection failure is told apart from a missing object: the first makes the
 * store unreachable, the second is simply an absent statement.
 */

import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.ts';

/** Raised when the store itself cannot be reached. */
export class StorageUnreachable extends Error {
  constructor(cause: string) {
    super(`The statement store is unreachable: ${cause}`);
    this.name = 'StorageUnreachable';
  }
}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const REQUEST_TIMEOUT_MS = 4000;

function sha256Hex(payload: Uint8Array | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986 encoding, applied per path segment. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function amzDate(now: Date): { stamp: string; dateOnly: string } {
  const stamp = `${now.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
  return { stamp, dateOnly: stamp.slice(0, 8) };
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/**
 * Builds the signed URL and headers for one object-store request. Path-style
 * addressing puts the bucket in the path, as MinIO expects.
 */
function sign(
  method: string,
  objectKey: string | null,
  payload: Uint8Array | string | null,
  extraHeaders: Readonly<Record<string, string>>,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const bucketSegment = config.s3.forcePathStyle ? `/${encodeSegment(config.s3.bucket)}` : '';
  const keyPath =
    objectKey === null ? '' : `/${objectKey.split('/').map(encodeSegment).join('/')}`;
  const canonicalUri = `${bucketSegment}${keyPath}` === '' ? '/' : `${bucketSegment}${keyPath}`;

  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;
  const { stamp, dateOnly } = amzDate(new Date());
  const payloadHash = payload === null ? EMPTY_SHA256 : sha256Hex(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };

  const headerNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowerHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()]),
  );
  const canonicalHeaders = headerNames
    .map((name) => `${name}:${lowerHeaders.get(name) ?? ''}\n`)
    .join('');
  const signedHeaders = headerNames.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateOnly}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateOnly);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${endpoint.origin}${canonicalUri}`, headers };
}

async function send(
  method: string,
  objectKey: string | null,
  payload: Uint8Array | string | null,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const signed = sign(method, objectKey, payload, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      ...(payload === null ? {} : { body: payload }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageUnreachable(error instanceof Error ? error.message : 'unknown');
  }
}

let bucketReady = false;

/**
 * Creates the bucket if it doesn't exist. Called at start and again before
 * any write, so a store that was unreachable at boot is prepared as soon as
 * it answers.
 */
export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await send('HEAD', null, null);
  if (head.ok) {
    bucketReady = true;
    return;
  }
  if (head.status === 404) {
    const made = await send('PUT', null, '');
    // Another process may have created it between the head and the put.
    if (!made.ok && made.status !== 409) {
      throw new StorageUnreachable(`bucket creation answered ${made.status}`);
    }
    bucketReady = true;
    return;
  }
  throw new StorageUnreachable(`bucket check answered ${head.status}`);
}

export async function putObject(
  key: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  const payload = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const response = await send('PUT', key, payload, {
    'content-type': contentType,
    'content-length': String(payload.byteLength),
  });
  if (!response.ok) {
    throw new StorageUnreachable(`put ${key} answered ${response.status}`);
  }
}

/** True when the object is in storage. A connection failure is not an answer. */
export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', key, null);
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new StorageUnreachable(`head ${key} answered ${response.status}`);
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  const response = await send('GET', key, null);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnreachable(`get ${key} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Removes an object written for a settlement that then failed to commit. */
export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key, null);
  if (!response.ok && response.status !== 404) {
    throw new StorageUnreachable(`delete ${key} answered ${response.status}`);
  }
}
