import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

type SignedRequest = { url: string; headers: Record<string, string> };

function signRequest(
  method: string,
  objectKey: string | null,
  payload: Buffer,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const pathParts = [config.s3.bucket, ...(objectKey ? objectKey.split('/') : [])];
  const canonicalUri = `/${pathParts.map(encodePathSegment).join('/')}`;
  const url = `${endpoint.origin}${canonicalUri}`;

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = payload.length === 0 ? EMPTY_SHA256 : sha256Hex(payload);

  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
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
    canonicalUri,
    '',
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

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url, headers };
}

async function send(
  method: string,
  objectKey: string | null,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, objectKey, payload, extraHeaders);
  return fetch(signed.url, {
    method,
    headers: signed.headers,
    body: payload.length > 0 ? new Uint8Array(payload) : undefined,
    signal: AbortSignal.timeout(4000),
  });
}

export class StorageUnavailable extends Error {
  constructor() {
    super('storage_unavailable');
  }
}

let storageUp = false;
let checkedAt = new Date();

export function storageStatus(): { storage: 'up' | 'down'; checked_at: string } {
  return { storage: storageUp ? 'up' : 'down', checked_at: checkedAt.toISOString() };
}

export function isStorageUp(): boolean {
  return storageUp;
}

async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', null, Buffer.alloc(0));
  if (head.status === 404) {
    const made = await send('PUT', null, Buffer.alloc(0));
    if (!made.ok && made.status !== 409) {
      throw new Error(`Could not create bucket: ${made.status}`);
    }
    return;
  }
  if (!head.ok) throw new Error(`Bucket check failed: ${head.status}`);
}

async function runCheck(): Promise<void> {
  try {
    await ensureBucket();
    storageUp = true;
  } catch {
    storageUp = false;
  }
  checkedAt = new Date();
}

export function startStorageChecks(): void {
  void runCheck();
  setInterval(() => void runCheck(), 5000).unref();
}

export async function putObject(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const response = await send('PUT', objectKey, body, { 'content-type': contentType }).catch(
    () => null,
  );
  if (!response || !response.ok) {
    storageUp = false;
    throw new StorageUnavailable();
  }
}

export async function getObject(objectKey: string): Promise<Buffer | null> {
  const response = await send('GET', objectKey, Buffer.alloc(0)).catch(() => null);
  if (response && response.status === 404) return null;
  if (!response || !response.ok) {
    storageUp = false;
    throw new StorageUnavailable();
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(objectKey: string): Promise<void> {
  await send('DELETE', objectKey, Buffer.alloc(0)).catch(() => null);
}

export function orderDocumentKey(operatorId: string, orderNumber: string): string {
  return `orders/${operatorId}/${orderNumber}.json`;
}

export function returnLabelKey(operatorId: string, returnNumber: string): string {
  return `returns/${operatorId}/${returnNumber}.txt`;
}
