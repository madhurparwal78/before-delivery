import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export class StorageUnavailable extends Error {}

const service = 's3';

function sha256(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now: Date): { long: string; short: string } {
  const long = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { long, short: long.slice(0, 8) };
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  objectKey: string | null,
  body: Buffer,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(config.storage.endpoint);
  const path = config.storage.forcePathStyle
    ? `/${config.storage.bucket}${objectKey === null ? '' : `/${encodeKey(objectKey)}`}`
    : `${objectKey === null ? '/' : `/${encodeKey(objectKey)}`}`;
  const host = config.storage.forcePathStyle
    ? endpoint.host
    : `${config.storage.bucket}.${endpoint.host}`;

  const { long, short } = amzDate(new Date());
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': long,
    ...extraHeaders,
  };

  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${String(headers[name] ?? headers[name.toLowerCase()]).trim()}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${short}/${config.storage.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    long,
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, short), config.storage.region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${endpoint.protocol}//${host}${path}`, headers };
}

async function send(
  method: string,
  objectKey: string | null,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, objectKey, body, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new StorageUnavailable('minio unreachable');
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const response = await send('PUT', key, body, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
  });
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StorageUnavailable(`put ${key} failed with ${response.status}`);
  }
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const response = await send('GET', key, Buffer.alloc(0));
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StorageUnavailable(`get ${key} failed with ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    body: bytes,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key, Buffer.alloc(0));
  await response.arrayBuffer();
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(`delete ${key} failed with ${response.status}`);
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', null, Buffer.alloc(0));
  await head.arrayBuffer();
  if (head.ok) return;
  if (head.status !== 404) throw new StorageUnavailable(`bucket check failed ${head.status}`);
  const created = await send('PUT', null, Buffer.alloc(0));
  await created.arrayBuffer();
  if (!created.ok && created.status !== 409) {
    throw new StorageUnavailable(`bucket create failed ${created.status}`);
  }
}

export async function storageUp(): Promise<boolean> {
  try {
    const head = await send('HEAD', null, Buffer.alloc(0));
    await head.arrayBuffer();
    return head.ok;
  } catch {
    return false;
  }
}

export const objectKeys = {
  pass: (orderRef: string, passCode: string): string => `passes/${orderRef}/${passCode}.pdf`,
  proof: (orderRef: string, proofId: string): string => `proofs/${orderRef}/${proofId}`,
  artworkOriginal: (entryId: string, imageId: string): string =>
    `artworks/originals/${entryId}/${imageId}`,
  artworkDisplay: (entryId: string, imageId: string): string =>
    `artworks/display/${entryId}/${imageId}.jpg`,
};
