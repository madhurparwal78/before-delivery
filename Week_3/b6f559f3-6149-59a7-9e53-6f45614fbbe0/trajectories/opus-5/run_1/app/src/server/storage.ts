import { createHash, createHmac } from 'node:crypto';
import { config } from './config';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
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
  objectKey: string,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
  queryString = '',
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${objectKey ? `/${encodeKey(objectKey)}` : ''}`
    : `${objectKey ? `/${encodeKey(objectKey)}` : '/'}`;
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;
  const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const sortedKeys = Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort();
  const canonicalHeaders = sortedKeys
    .map((key) => {
      const value = Object.entries(headers).find(([name]) => name.toLowerCase() === key)?.[1] ?? '';
      return `${key}:${String(value).trim()}\n`;
    })
    .join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [
    method,
    path,
    queryString,
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
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `${endpoint.protocol}//${endpoint.host}${path}${queryString ? `?${queryString}` : ''}`,
    headers,
  };
}

export class StorageUnavailable extends Error {}

async function send(
  method: string,
  objectKey: string,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
  queryString = '',
): Promise<Response> {
  const signed = signRequest(method, objectKey, body, extraHeaders, queryString);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body ?? undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    throw new StorageUnavailable((error as Error).message);
  }
}

let bucketReady = false;

export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await send('HEAD', '', null);
  if (head.ok) {
    bucketReady = true;
    return;
  }
  if (head.status === 404) {
    const created = await send('PUT', '', Buffer.alloc(0));
    if (!created.ok && created.status !== 409) {
      throw new StorageUnavailable(`Could not create bucket: ${created.status}`);
    }
    bucketReady = true;
    return;
  }
  throw new StorageUnavailable(`Bucket check failed: ${head.status}`);
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  const response = await send('PUT', key, body, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
  });
  if (!response.ok) throw new StorageUnavailable(`PUT ${key} failed: ${response.status}`);
}

/** An object counts only after its metadata reads back. */
export async function confirmObject(key: string, expectedBytes: number): Promise<boolean> {
  const response = await send('HEAD', key, null);
  if (!response.ok) return false;
  const length = Number(response.headers.get('content-length') ?? '-1');
  return length === expectedBytes;
}

export async function getObject(
  key: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const response = await send('GET', key, null);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`GET ${key} failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    body: buffer,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function deleteObject(key: string): Promise<void> {
  await send('DELETE', key, null);
}

export async function storageHealthy(): Promise<boolean> {
  try {
    const response = await send('HEAD', '', null);
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function emptyBucket(): Promise<void> {
  try {
    await ensureBucket();
  } catch {
    return;
  }
  for (;;) {
    const response = await send('GET', '', null, {}, 'list-type=2&max-keys=1000');
    if (!response.ok) return;
    const text = await response.text();
    const keys = [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) =>
      match[1].replace(/&amp;/g, '&'),
    );
    if (keys.length === 0) return;
    for (const key of keys) await deleteObject(key);
    if (keys.length < 1000) return;
  }
}

export const storageKeys = {
  asset: (projectId: string, assetId: string): string =>
    `projects/${projectId}/assets/${assetId}/original`,
  importOriginal: (projectId: string): string => `projects/${projectId}/imports/original.json`,
  versionBundle: (projectId: string, number: number): string =>
    `projects/${projectId}/versions/${number}/scene.json`,
};

export function resetBucketReady(): void {
  bucketReady = false;
}
