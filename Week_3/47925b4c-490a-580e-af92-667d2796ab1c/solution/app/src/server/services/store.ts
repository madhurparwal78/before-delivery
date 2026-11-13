import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StoreUnreachable extends Error {}

const UNRESERVED = /[^A-Za-z0-9\-._~]/g;

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => part.replace(UNRESERVED, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function sign(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function signRequest(method: string, key: string, payload: Buffer, extra: Record<string, string> = {}): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${key === '' ? '' : `/${encodePath(key)}`}`
    : `/${encodePath(key)}`;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = stamp.slice(0, 8);
  const payloadHash = createHash('sha256').update(payload).digest('hex');
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extra,
  };
  const normalised: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) normalised[name.toLowerCase()] = value.trim();
  const names = Object.keys(normalised).sort();
  const canonicalHeaders = names.map((name) => `${name}:${normalised[name]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signingKey = sign(sign(sign(sign(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.protocol}//${endpoint.host}${path}`, headers };
}

async function call(method: string, key: string, payload: Buffer, extra: Record<string, string> = {}): Promise<Response> {
  const signed = signRequest(method, key, payload, extra);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StoreUnreachable(`cannot reach the object store for ${key}`);
  }
}

export async function ensureBucket(): Promise<void> {
  const response = await call('PUT', '', Buffer.alloc(0));
  await response.arrayBuffer();
  if (!response.ok && response.status !== 409) throw new StoreUnreachable(`cannot create the bucket: ${response.status}`);
}

interface StoredObject {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** Writes an object and reads its size and checksum back before reporting it stored. */
export async function putObject(key: string, payload: Buffer, contentType: string): Promise<StoredObject> {
  const sha256 = createHash('sha256').update(payload).digest('hex');
  const md5 = createHash('md5').update(payload).digest('hex');
  const put = await call('PUT', key, payload, { 'content-type': contentType });
  await put.arrayBuffer();
  if (!put.ok) throw new StoreUnreachable(`the object store refused ${key}: ${put.status}`);
  const head = await call('HEAD', key, Buffer.alloc(0));
  await head.arrayBuffer();
  if (!head.ok) throw new StoreUnreachable(`the object store lost ${key}`);
  const size = Number(head.headers.get('content-length'));
  const etag = (head.headers.get('etag') ?? '').replaceAll('"', '');
  if (size !== payload.length || etag !== md5) {
    throw new StoreUnreachable(`the object store disagrees about ${key}`);
  }
  return { key, sha256, bytes: payload.length };
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await call('GET', key, Buffer.alloc(0));
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StoreUnreachable(`the object store refused to read ${key}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call('DELETE', key, Buffer.alloc(0));
  await response.arrayBuffer();
}
