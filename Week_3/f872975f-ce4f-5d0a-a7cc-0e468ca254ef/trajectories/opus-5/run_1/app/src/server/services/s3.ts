import { createHash, createHmac } from 'node:crypto';
import { SERVICE_TIMEOUT_MS, config } from '../config';
import { ApiError } from '../errors';
import { markService, registerProbe } from './health';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function uriEncodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, objectPath: string, payloadHash: string, extraHeaders: Record<string, string>): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalUri = uriEncodePath(objectPath);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${(headers[name] ?? '').trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers.host;
  return { url: `${endpoint.origin}${canonicalUri}`, headers };
}

function objectPath(key: string): string {
  return config.s3.forcePathStyle ? `/${config.s3.bucket}/${key}` : `/${key}`;
}

function bucketPath(): string {
  return config.s3.forcePathStyle ? `/${config.s3.bucket}` : '/';
}

const storageUnavailable = (): ApiError => new ApiError('storage_unavailable');

async function send(
  method: string,
  path: string,
  payload: Buffer | null,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const payloadHash = payload === null ? EMPTY_SHA256 : sha256Hex(payload);
  const signed = sign(method, path, payloadHash, extraHeaders);
  try {
    const response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload === null ? undefined : new Uint8Array(payload),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS)
    });
    if (response.status >= 500) {
      await response.arrayBuffer().catch(() => undefined);
      markService('storage', 'down');
      throw storageUnavailable();
    }
    markService('storage', 'up');
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    markService('storage', 'down');
    throw storageUnavailable();
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', objectPath(key), body, { 'content-type': contentType });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw storageUnavailable();
  }
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const response = await send('GET', objectPath(key), null);
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw storageUnavailable();
  }
  const body = Buffer.from(await response.arrayBuffer());
  return { body, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', objectPath(key), null);
  await response.arrayBuffer().catch(() => undefined);
}

async function probeStorage(): Promise<boolean> {
  try {
    const response = await send('HEAD', bucketPath(), null);
    await response.arrayBuffer().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

registerProbe('storage', probeStorage);

export async function ensureBucket(): Promise<void> {
  try {
    const head = await send('HEAD', bucketPath(), null);
    await head.arrayBuffer().catch(() => undefined);
    if (head.status !== 404) return;
    const created = await send('PUT', bucketPath(), Buffer.alloc(0));
    await created.arrayBuffer().catch(() => undefined);
  } catch {
    // The bucket is created again on the next start; storage stays degraded until then.
  }
}
