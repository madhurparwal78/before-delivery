import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const TIMEOUT_MS = 10_000;

export class StorageUnreachable extends Error {}
export class StorageMissing extends Error {}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

type S3Request = {
  method: 'PUT' | 'GET' | 'HEAD';
  key: string;
  body?: Buffer;
  contentType?: string;
};

function signedHeaders(request: S3Request, url: URL, payloadHash: string): HeadersInit {
  const { stamp, date } = amzDate(new Date());
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (request.contentType !== undefined) headers['content-type'] = request.contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaderNames = names.join(';');
  const canonicalRequest = [
    request.method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
  };
}

async function call(request: S3Request): Promise<Response> {
  const base = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${encodePath(request.key)}`
    : `/${encodePath(request.key)}`;
  const url = new URL(path, base);
  if (!config.s3.forcePathStyle) url.host = `${config.s3.bucket}.${base.host}`;
  const payloadHash = sha256Hex(request.body ?? '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: request.method,
      headers: signedHeaders(request, url, payloadHash),
      body: request.body,
      signal: controller.signal,
    });
  } catch (error) {
    throw new StorageUnreachable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function objectKey(documentId: string, exportId: string): string {
  return `exports/${documentId}/${exportId}.csv`;
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  const response = await call({
    method: 'PUT',
    key,
    body,
    contentType: 'text/csv; charset=utf-8',
  });
  if (!response.ok) throw new StorageUnreachable(`storage answered ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await call({ method: 'GET', key });
  if (response.status === 404) throw new StorageMissing(key);
  if (!response.ok) throw new StorageUnreachable(`storage answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function ensureBucket(): Promise<void> {
  const base = new URL(config.s3.endpoint);
  const url = new URL(`/${config.s3.bucket}`, base);
  const payloadHash = sha256Hex('');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      headers: signedHeaders({ method: 'HEAD', key: '' }, url, payloadHash),
      signal: controller.signal,
    });
    if (head.status === 404) {
      await fetch(url, {
        method: 'PUT',
        headers: signedHeaders({ method: 'PUT', key: '' }, url, payloadHash),
        signal: controller.signal,
      });
    }
  } catch {
    return;
  } finally {
    clearTimeout(timer);
  }
}

export function sha256OfBuffer(body: Buffer): string {
  return sha256Hex(body);
}
