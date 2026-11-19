import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

const STORAGE_TIMEOUT_MS = 3000;

export class StorageUnreachable extends Error {}
export class StorageRefused extends Error {}
export class StorageObjectMissing extends Error {}

function sha256Hex(payload: Uint8Array | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function signedUrlAndHeaders(
  method: string,
  key: string,
  payload: Uint8Array,
  extraHeaders: Readonly<Record<string, string>>,
): { url: string; headers: Record<string, string> } {
  const endpoint = new URL(config.storage.endpoint);
  const path = config.storage.forcePathStyle
    ? `/${encodeSegment(config.storage.bucket)}${key === '' ? '' : `/${key.split('/').map(encodeSegment).join('/')}`}`
    : `/${key.split('/').map(encodeSegment).join('/')}`;
  const host = config.storage.forcePathStyle
    ? endpoint.host
    : `${config.storage.bucket}.${endpoint.host}`;

  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };

  const canonicalHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowered = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()]),
  );
  const canonicalHeaders = canonicalHeaderNames
    .map((name) => `${name}:${lowered.get(name) ?? ''}\n`)
    .join('');
  const signedHeaders = canonicalHeaderNames.join(';');

  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.storage.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, dateStamp), config.storage.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.origin}${path}`, headers };
}

async function send(
  method: string,
  key: string,
  payload: Uint8Array,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const { url, headers } = signedUrlAndHeaders(method, key, payload, extraHeaders);
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
  };
  if (method === 'PUT' || method === 'POST') init.body = new Blob([new Uint8Array(payload)]);
  try {
    return await fetch(url, init);
  } catch (cause) {
    throw new StorageUnreachable(`storage_unreachable: ${String(cause)}`);
  }
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const response = await send('PUT', key, body, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
  });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageRefused(`storage_refused: ${response.status}`);
  }
  await response.arrayBuffer().catch(() => undefined);
}

export async function getObject(
  key: string,
): Promise<{ body: Buffer; contentType: string }> {
  const response = await send('GET', key, new Uint8Array());
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageObjectMissing(key);
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageRefused(`storage_refused: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    body: buffer,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key, new Uint8Array());
  await response.arrayBuffer().catch(() => undefined);
  if (response.status === 404 || response.status === 204 || response.ok) return;
  throw new StorageRefused(`storage_refused: ${response.status}`);
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', key, new Uint8Array());
  await response.arrayBuffer().catch(() => undefined);
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageRefused(`storage_refused: ${response.status}`);
  return true;
}

export async function probeStorage(): Promise<boolean> {
  try {
    const response = await send('HEAD', '', new Uint8Array());
    await response.arrayBuffer().catch(() => undefined);
    return response.status < 500;
  } catch {
    return false;
  }
}
