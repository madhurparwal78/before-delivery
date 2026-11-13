import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageUnavailable extends Error {
  constructor(reason: string) {
    super(`score store unavailable: ${reason}`);
  }
}

const PROBE_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;

function hash(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function amzDate(now: Date): { stamp: string; day: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, day: stamp.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  objectPath: string,
  query: string,
  payload: Buffer | null,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const { endpoint, region, accessKeyId, secretAccessKey, forcePathStyle, bucket } = config.storage;
  if (endpoint === '' || bucket === '' || accessKeyId === '' || secretAccessKey === '') {
    throw new StorageUnavailable('not configured');
  }
  const base = new URL(endpoint);
  const segments = objectPath === '' ? [] : objectPath.split('/').map(encodeSegment);
  const canonicalPath = forcePathStyle
    ? `/${[encodeSegment(bucket), ...segments].join('/')}`
    : `/${segments.join('/')}`;
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const payloadHash = payload === null ? hash('') : hash(payload);
  const { stamp, day } = amzDate(new Date());

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${(headers[name] ?? '').trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, canonicalPath, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const sendableHeaders = Object.fromEntries(
    names.filter((name) => name !== 'host').map((name) => [name, headers[name] ?? '']),
  );
  return {
    url: `${base.protocol}//${host}${canonicalPath}${query === '' ? '' : `?${query}`}`,
    headers: {
      ...sendableHeaders,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function callStore(
  method: string,
  objectPath: string,
  query: string,
  payload: Buffer | null,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const signed = signRequest(method, objectPath, query, payload, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload === null ? undefined : new Uint8Array(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new StorageUnavailable(error instanceof Error ? error.message : 'request failed');
  }
}

export async function putScanObject(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const response = await callStore(
    'PUT',
    objectKey,
    '',
    body,
    { 'content-type': contentType },
    REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) throw new StorageUnavailable(`write answered ${response.status}`);
  await response.arrayBuffer();
}

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export async function getScanObject(objectKey: string): Promise<StoredObject> {
  const response = await callStore('GET', objectKey, '', null, {}, REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new StorageUnavailable(`read answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function deleteScanObject(objectKey: string): Promise<void> {
  const response = await callStore('DELETE', objectKey, '', null, {}, REQUEST_TIMEOUT_MS);
  await response.arrayBuffer();
  if (!response.ok && response.status !== 404) throw new StorageUnavailable(`delete answered ${response.status}`);
}

/** Reads the written object back and checks its size and checksum against the upload. */
export async function confirmScanObject(objectKey: string, body: Buffer, sha256: string): Promise<void> {
  const stored = await getScanObject(objectKey);
  if (stored.bytes.length !== body.length) throw new StorageUnavailable('stored size differs');
  if (hash(stored.bytes) !== sha256) throw new StorageUnavailable('stored checksum differs');
}

export async function storageIsUp(): Promise<boolean> {
  try {
    const response = await callStore('GET', '', 'list-type=2&max-keys=0', null, {}, PROBE_TIMEOUT_MS);
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
