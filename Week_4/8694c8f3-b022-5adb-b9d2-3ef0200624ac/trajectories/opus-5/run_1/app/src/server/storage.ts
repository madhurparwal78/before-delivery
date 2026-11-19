import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { Err } from './errors.js';

/** Minimal SigV4 object storage client: MinIO is reached only from the server. */

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
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

function sign(method: string, key: string, payload: Buffer, extraHeaders: Record<string, string>): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${key === '' ? '' : `/${encodeKey(key)}`}`
    : `${key === '' ? '/' : `/${encodeKey(key)}`}`;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${(headers[name] ?? '').trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers['authorization'] = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.origin}${path}`, headers };
}

let storageOk = false;

export function storageHealthy(): boolean {
  return storageOk;
}

async function call(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, key, payload, extraHeaders);
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    storageOk = false;
    throw Err.storageUnavailable();
  }
  if (response.status >= 500) {
    storageOk = false;
    throw Err.storageUnavailable();
  }
  storageOk = true;
  return response;
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const response = await call('PUT', key, bytes, { 'content-type': contentType });
  if (!response.ok) throw Err.storageUnavailable();
}

export interface ObjectMetadata {
  size: number;
  checksum: string | null;
}

export async function headObject(key: string): Promise<ObjectMetadata | null> {
  const response = await call('HEAD', key, Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) throw Err.storageUnavailable();
  return {
    size: Number(response.headers.get('content-length') ?? '0'),
    checksum: (response.headers.get('etag') ?? '').replaceAll('"', '') || null,
  };
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await call('GET', key, Buffer.alloc(0));
  if (!response.ok) throw Err.storageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call('DELETE', key, Buffer.alloc(0));
  if (!response.ok && response.status !== 404) throw Err.storageUnavailable();
}

/**
 * Writes the exact bytes and confirms them with a follow-up metadata read.
 * Returns the sha256 of exactly those bytes once storage has confirmed the write.
 */
export async function putAndConfirm(key: string, bytes: Buffer, contentType: string): Promise<string> {
  const digest = sha256Hex(bytes);
  await putObject(key, bytes, contentType);
  const metadata = await headObject(key);
  if (metadata === null || metadata.size !== bytes.length) throw Err.storageUnavailable();
  return digest;
}

async function ensureBucket(): Promise<void> {
  const head = await call('HEAD', '', Buffer.alloc(0));
  if (head.status === 404) {
    const made = await call('PUT', '', Buffer.alloc(0));
    if (!made.ok && made.status !== 409) throw Err.storageUnavailable();
  }
}

export function startStorageHealthLoop(): void {
  const check = async (): Promise<void> => {
    try {
      await ensureBucket();
      storageOk = true;
    } catch {
      storageOk = false;
    }
  };
  void check();
  setInterval(() => void check(), 5000).unref();
}

export const keys = {
  asset: (setId: string, assetId: string) => `sets/${setId}/assets/${assetId}`,
  bundle: (setId: string, versionNumber: number) => `sets/${setId}/shows/${versionNumber}/bundle.json`,
  exportZip: (setId: string, exportId: string) => `sets/${setId}/exports/${exportId}.zip`,
  importZip: (importId: string) => `imports/${importId}.zip`,
};
