import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 4000;

export class StorageUnavailable extends Error {}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDates(): { amzDate: string; dateStamp: string } {
  const iso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodePath(objectKey: string): string {
  return objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function objectUrl(objectKey: string): URL {
  const base = new URL(config.s3.endpoint);
  const prefix = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '';
  base.pathname = `${prefix}/${encodePath(objectKey)}`;
  return base;
}

function bucketUrl(): URL {
  const base = new URL(config.s3.endpoint);
  base.pathname = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '/';
  return base;
}

function signedHeaders(
  method: string,
  url: URL,
  body: Buffer,
  extra: Record<string, string> = {},
): Record<string, string> {
  const { amzDate, dateStamp } = amzDates();
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extra,
  };

  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => {
      const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
      return `${name}:${String(entry?.[1] ?? '').trim()}\n`;
    })
    .join('');
  const signedHeaderList = sortedNames.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaderList}, Signature=${signature}`,
  };
}

async function send(
  method: string,
  url: URL,
  body: Buffer,
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers = signedHeaders(method, url, body, extra);
  try {
    return await fetch(url, {
      method,
      headers,
      body: method === 'PUT' || method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable('Object storage is unreachable');
  }
}

export async function isStorageUp(): Promise<boolean> {
  try {
    const response = await send('HEAD', bucketUrl(), Buffer.alloc(0));
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const response = await send('HEAD', bucketUrl(), Buffer.alloc(0));
  if (response.status === 404) {
    const created = await send('PUT', bucketUrl(), Buffer.alloc(0));
    if (!created.ok) throw new StorageUnavailable(`Cannot create bucket: ${created.status}`);
  }
}

export async function putObject(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const response = await send('PUT', objectUrl(objectKey), body, {
    'content-type': contentType,
  });
  if (!response.ok) throw new StorageUnavailable(`Store failed: ${response.status}`);
}

/** The object's size as object storage reports it, or null when there is no object. */
export async function headObjectSize(objectKey: string): Promise<number | null> {
  const response = await send('HEAD', objectUrl(objectKey), Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`Head failed: ${response.status}`);
  const length = response.headers.get('content-length');
  if (length === null) throw new StorageUnavailable('Storage reported no object size');
  return Number(length);
}

export async function getObject(objectKey: string): Promise<Buffer> {
  const response = await send('GET', objectUrl(objectKey), Buffer.alloc(0));
  if (!response.ok) throw new StorageUnavailable(`Fetch failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(objectKey: string): Promise<void> {
  const response = await send('DELETE', objectUrl(objectKey), Buffer.alloc(0));
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(`Delete failed: ${response.status}`);
  }
}
