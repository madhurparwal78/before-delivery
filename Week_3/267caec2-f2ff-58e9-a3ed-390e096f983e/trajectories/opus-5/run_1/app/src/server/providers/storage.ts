import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

export class StorageUnavailableError extends Error {}

interface S3Response {
  status: number;
  body: Buffer;
  contentType: string | null;
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

async function send(
  method: string,
  key: string,
  query: Record<string, string>,
  payload: Buffer,
  contentType: string | null,
): Promise<S3Response> {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey, forcePathStyle } = config.storage;
  const base = new URL(endpoint);
  const path = forcePathStyle ? `/${bucket}${key === '' ? '' : `/${encodePath(key)}`}` : `/${encodePath(key)}`;
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
    .join('&');

  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (contentType !== null) headers['content-type'] = contentType;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaderList = signedHeaders.join(';');
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;

  const url = `${base.protocol}//${base.host}${path}${canonicalQuery === '' ? '' : `?${canonicalQuery}`}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : payload,
      signal: AbortSignal.timeout(config.providerTimeoutMs),
    });
  } catch (error) {
    throw new StorageUnavailableError(`storage request failed: ${String(error)}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (response.status >= 500) {
    throw new StorageUnavailableError(`storage answered ${response.status}`);
  }
  return { status: response.status, body, contentType: response.headers.get('content-type') };
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '', {}, Buffer.alloc(0), null);
  if (head.status === 404) {
    await send('PUT', '', {}, Buffer.alloc(0), null);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const result = await send('PUT', key, {}, body, contentType);
  if (result.status === 404) {
    await ensureBucket();
    const retry = await send('PUT', key, {}, body, contentType);
    if (retry.status !== 200) throw new StorageUnavailableError(`put ${key} answered ${retry.status}`);
    return;
  }
  if (result.status !== 200) throw new StorageUnavailableError(`put ${key} answered ${result.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const result = await send('GET', key, {}, Buffer.alloc(0), null);
  if (result.status === 404) return null;
  if (result.status !== 200) throw new StorageUnavailableError(`get ${key} answered ${result.status}`);
  return result.body;
}

export async function objectExists(key: string): Promise<boolean> {
  const result = await send('HEAD', key, {}, Buffer.alloc(0), null);
  if (result.status === 200) return true;
  if (result.status === 404) return false;
  throw new StorageUnavailableError(`head ${key} answered ${result.status}`);
}

export async function deleteObject(key: string): Promise<void> {
  const result = await send('DELETE', key, {}, Buffer.alloc(0), null);
  if (result.status !== 204 && result.status !== 200 && result.status !== 404) {
    throw new StorageUnavailableError(`delete ${key} answered ${result.status}`);
  }
}

export async function deletePrefix(prefix: string): Promise<void> {
  const listing = await send('GET', '', { 'list-type': '2', prefix }, Buffer.alloc(0), null);
  if (listing.status !== 200) throw new StorageUnavailableError(`list ${prefix} answered ${listing.status}`);
  const xml = listing.body.toString('utf8');
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  for (const key of keys) {
    await deleteObject(key);
  }
}
