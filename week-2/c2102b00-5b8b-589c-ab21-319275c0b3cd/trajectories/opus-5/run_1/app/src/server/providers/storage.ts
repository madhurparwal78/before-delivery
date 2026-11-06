import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.ts';

export class StorageUnavailableError extends Error {
  constructor() {
    super('MinIO is unreachable');
  }
}

const TIMEOUT_MS = 5000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function objectUrl(key: string): URL {
  const base = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) {
    base.pathname = `/${config.s3.bucket}/${encodeKeyPath(key)}`;
    return base;
  }
  base.hostname = `${config.s3.bucket}.${base.hostname}`;
  base.pathname = `/${encodeKeyPath(key)}`;
  return base;
}

interface SignedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
}

function sign(method: string, url: URL, payload: Buffer, extraHeaders: Record<string, string>): SignedRequest {
  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const pairs = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .sort((left, right) => (left[0] < right[0] ? -1 : 1));
  const canonicalHeaders = pairs.map(([name, value]) => `${name}:${value}\n`).join('');
  const signedHeaders = pairs.map(([name]) => name).join(';');
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, method, headers };
}

interface StorageResponse {
  status: number;
  body: Buffer;
}

async function send(method: string, key: string, payload: Buffer, extraHeaders: Record<string, string> = {}): Promise<StorageResponse> {
  const url = objectUrl(key);
  const signed = sign(method, url, payload, extraHeaders);
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' ? new Uint8Array(payload) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailableError();
  }
  const body = Buffer.from(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (response.status >= 500) throw new StorageUnavailableError();
  return { status: response.status, body };
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', key, bytes, { 'content-type': contentType });
  if (response.status !== 200) throw new StorageUnavailableError();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', key, Buffer.alloc(0));
  if (response.status === 404) return null;
  if (response.status !== 200) throw new StorageUnavailableError();
  return response.body;
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', key, Buffer.alloc(0));
  if (response.status === 404) return false;
  if (response.status !== 200) throw new StorageUnavailableError();
  return true;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key, Buffer.alloc(0));
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
    throw new StorageUnavailableError();
  }
}
