import { createHash, createHmac } from 'node:crypto';
import { config } from './config';

/** A minimal SigV4 client for the attachment store. */

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, path: string, payload: Buffer, contentType: string | null): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalPath = encodePath(path);
  const host = endpoint.host;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType !== null) headers['content-type'] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    method,
    canonicalPath,
    '',
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

  const requestHeaders: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType !== null) requestHeaders['content-type'] = contentType;

  return { url: `${endpoint.origin}${canonicalPath}`, headers: requestHeaders };
}

const EMPTY = Buffer.alloc(0);

export function objectKey(gameSlug: string, attachmentId: string): string {
  return `attachments/${gameSlug}/${attachmentId}`;
}

function bucketPath(key: string): string {
  return `/${config.s3.bucket}/${key}`;
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = sign('HEAD', `/${config.s3.bucket}`, EMPTY, null);
  const existing = await fetch(head.url, { method: 'HEAD', headers: head.headers });
  if (existing.ok) {
    bucketReady = true;
    return;
  }
  const create = sign('PUT', `/${config.s3.bucket}`, EMPTY, null);
  const made = await fetch(create.url, { method: 'PUT', headers: create.headers });
  if (!made.ok && made.status !== 409) throw new Error(`bucket unavailable: ${made.status}`);
  bucketReady = true;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const request = sign('PUT', bucketPath(key), body, contentType);
  const response = await fetch(request.url, {
    method: 'PUT',
    headers: request.headers,
    body: new Uint8Array(body),
  });
  if (!response.ok) throw new Error(`store refused the object: ${response.status}`);
}

/** The stored object's size, read back from the store. */
export async function headObjectSize(key: string): Promise<number | null> {
  const request = sign('HEAD', bucketPath(key), EMPTY, null);
  const response = await fetch(request.url, { method: 'HEAD', headers: request.headers });
  if (!response.ok) return null;
  const length = response.headers.get('content-length');
  return length === null ? null : Number(length);
}

export async function getObject(key: string): Promise<Buffer> {
  const request = sign('GET', bucketPath(key), EMPTY, null);
  const response = await fetch(request.url, { method: 'GET', headers: request.headers });
  if (!response.ok) throw new Error(`store refused the object: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
