import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

export class ImageStoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('image store unavailable');
    this.name = 'ImageStoreUnavailableError';
    this.cause = cause;
  }
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; dateOnly: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, dateOnly: stamp.slice(0, 8) };
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
  path: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const { stamp, dateOnly } = amzDate(new Date());
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const sortedKeys = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedKeys
    .map((name) => `${name}:${String(headers[name] ?? headers[name.toLowerCase()]).trim()}\n`)
    .join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateOnly}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateOnly);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.origin}${path}`, headers };
}

async function send(
  method: string,
  path: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, path, body, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body:
        method === 'GET' || method === 'HEAD'
          ? undefined
          : new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    throw new ImageStoreUnavailableError(error);
  }
}

function objectPath(key: string): string {
  return `/${encodeURIComponent(config.s3.bucket)}/${encodeKey(key)}`;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const response = await send('PUT', objectPath(key), body, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
  });
  if (!response.ok) throw new ImageStoreUnavailableError(`put ${key} failed ${response.status}`);
}

export async function getObjectBytes(
  key: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const response = await send('GET', objectPath(key), Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) throw new ImageStoreUnavailableError(`get ${key} failed ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function probeImageStore(): Promise<boolean> {
  try {
    const response = await send(
      'HEAD',
      `/${encodeURIComponent(config.s3.bucket)}`,
      Buffer.alloc(0),
    );
    return response.ok;
  } catch {
    return false;
  }
}
