import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(date: Date): { stamp: string; short: string } {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, short: stamp.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, path: string, body: Uint8Array, contentType?: string): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalUri = encodePath(path.startsWith('/') ? path : `/${path}`);
  const { stamp, short } = amzDate(new Date());
  const payloadHash = sha256Hex(body);
  const host = endpoint.host;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${short}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, short);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.origin}${canonicalUri}`, headers };
}

async function request(
  method: string,
  path: string,
  body: Uint8Array,
  contentType?: string,
  timeoutMs = 5000,
): Promise<Response> {
  const signed = sign(method, path, body, contentType);
  return fetch(signed.url, {
    method,
    headers: signed.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const EMPTY = new Uint8Array();

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await request('HEAD', `/${config.s3.bucket}`, EMPTY, undefined, 1000);
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    const head = await request('HEAD', `/${config.s3.bucket}`, EMPTY);
    if (head.ok) return;
    await request('PUT', `/${config.s3.bucket}`, EMPTY);
  } catch {
    // The bucket is created on the next upload once storage is reachable.
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const response = await request('PUT', `/${config.s3.bucket}/${key}`, body, contentType);
  if (!response.ok) {
    if (response.status === 404) {
      await request('PUT', `/${config.s3.bucket}`, EMPTY);
      const retry = await request('PUT', `/${config.s3.bucket}/${key}`, body, contentType);
      if (retry.ok) return;
    }
    throw new Error(`storage put failed with ${response.status}`);
  }
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const response = await request('GET', `/${config.s3.bucket}/${key}`, EMPTY);
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    body: buffer,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}
