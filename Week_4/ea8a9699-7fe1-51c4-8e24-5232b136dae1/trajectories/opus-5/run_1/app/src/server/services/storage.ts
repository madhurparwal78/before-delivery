import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { errors } from '../errors.js';

const service = 's3';

function hash(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

interface S3Request {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  key?: string;
  body?: Buffer;
  headers?: Record<string, string>;
}

function sign(request: S3Request): { url: string; headers: Record<string, string> } {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const path = forcePathStyle
    ? `/${bucket}${request.key ? `/${request.key}` : ''}`
    : `${request.key ? `/${request.key}` : '/'}`;
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = hash(body);
  const { stamp, date } = amzDate(new Date());

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...request.headers,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name] ?? headers[name]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [request.method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${base.protocol}//${base.host}${path}`, headers };
}

async function send(request: S3Request): Promise<Response> {
  const { url, headers } = sign(request);
  try {
    return await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'PUT' ? request.body : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw errors.storageUnavailable();
  }
}

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
  metadata: Record<string, string> = {},
): Promise<void> {
  const headers: Record<string, string> = { 'content-type': contentType };
  for (const [name, value] of Object.entries(metadata)) {
    headers[`x-amz-meta-${name}`] = value;
  }
  const response = await send({ method: 'PUT', key, body: bytes, headers });
  if (!response.ok) {
    throw errors.storageUnavailable();
  }
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const response = await send({ method: 'GET', key });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw errors.storageUnavailable();
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send({ method: 'DELETE', key });
  if (!response.ok && response.status !== 404) {
    throw errors.storageUnavailable();
  }
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send({ method: 'HEAD', key });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw errors.storageUnavailable();
  }
  return true;
}

export async function ensureBucket(): Promise<void> {
  const head = await send({ method: 'HEAD' });
  if (head.ok) {
    return;
  }
  if (head.status !== 404) {
    throw errors.storageUnavailable();
  }
  const created = await send({ method: 'PUT' });
  if (!created.ok) {
    throw errors.storageUnavailable();
  }
}
