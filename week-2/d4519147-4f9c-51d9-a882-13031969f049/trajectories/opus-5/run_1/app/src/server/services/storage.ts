import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

/** A minimal S3 client: SigV4 signed PUT, GET and HEAD against the configured bucket. */

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, objectPath: string, payload: Buffer | null, extraHeaders: Record<string, string>): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const pathPrefix = config.s3.forcePathStyle ? `/${encodeSegment(config.s3.bucket)}` : '';
  const canonicalUri = `${pathPrefix}${objectPath
    .split('/')
    .map((segment) => encodeSegment(segment))
    .join('/')}`;
  const host = endpoint.host;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = payload ? createHash('sha256').update(payload).digest('hex') : EMPTY_SHA256;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name] ?? '').trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const base = config.s3.forcePathStyle
    ? `${endpoint.origin}${canonicalUri}`
    : `${endpoint.protocol}//${config.s3.bucket}.${host}${canonicalUri}`;
  return { url: base, headers };
}

export class StorageUnavailable extends Error {}

async function send(
  method: string,
  objectPath: string,
  payload: Buffer | null,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 5000,
): Promise<{ status: number; body: Buffer }> {
  const signed = sign(method, objectPath, payload, extraHeaders);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload ?? undefined,
      signal: controller.signal,
    });
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, body };
  } catch {
    throw new StorageUnavailable('storage unreachable');
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '/', null);
  if (head.status === 200) return;
  if (head.status === 404) {
    await send('PUT', '/', Buffer.alloc(0));
    return;
  }
  throw new StorageUnavailable(`bucket check failed with ${head.status}`);
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const result = await send('PUT', `/${key}`, bytes, {
    'content-type': contentType,
    'content-length': String(bytes.length),
  });
  if (result.status !== 200 && result.status !== 204) throw new StorageUnavailable(`put failed with ${result.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const result = await send('GET', `/${key}`, null);
  if (result.status === 404) return null;
  if (result.status !== 200) throw new StorageUnavailable(`get failed with ${result.status}`);
  return result.body;
}

export interface StoredObject {
  sizeBytes: number;
  sha256: string;
}

/** Reads an object back so an export only becomes ready once storage confirms it. */
export async function confirmObject(key: string, expected: StoredObject): Promise<boolean> {
  const bytes = await getObject(key);
  if (!bytes) return false;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return bytes.length === expected.sizeBytes && sha256 === expected.sha256;
}

export async function storageIsUp(): Promise<boolean> {
  try {
    const head = await send('HEAD', '/', null, {}, 2500);
    return head.status === 200 || head.status === 404;
  } catch {
    return false;
  }
}
