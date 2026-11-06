/** Private object storage over S3 with AWS SigV4, using fetch only. */
import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageUnavailable extends Error {}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

type S3Request = {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  key: string;
  body?: Buffer;
  contentType?: string;
};

function signedUrl(key: string): { url: URL; host: string } {
  const base = new URL(config.storage.endpoint);
  const path = config.storage.forcePathStyle
    ? `/${config.storage.bucket}/${encodeKey(key)}`
    : `/${encodeKey(key)}`;
  const url = new URL(path, base);
  if (!config.storage.forcePathStyle) {
    url.host = `${config.storage.bucket}.${base.host}`;
  }
  return { url, host: url.host };
}

async function send(request: S3Request): Promise<Response> {
  const { url, host } = signedUrl(request.key);
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const { stamp, date } = amzDate(new Date());

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (request.contentType) headers['content-type'] = request.contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    request.method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.storage.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, date), config.storage.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers['host'];

  try {
    return await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'PUT' ? body : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new StorageUnavailable();
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send({ method: 'PUT', key, body, contentType });
  if (!response.ok) {
    await response.body?.cancel();
    throw new StorageUnavailable();
  }
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send({ method: 'GET', key });
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new StorageUnavailable();
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send({ method: 'DELETE', key });
  if (!response.ok && response.status !== 404) {
    await response.body?.cancel();
    throw new StorageUnavailable();
  }
  await response.arrayBuffer();
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send({ method: 'GET', key: '.reachability-probe' });
    await response.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

export function documentKey(kitchenId: string, memberId: string, documentId: string): string {
  return `kitchens/${kitchenId}/members/${memberId}/documents/${documentId}`;
}

export function sanitationKey(kitchenId: string, month: string): string {
  return `kitchens/${kitchenId}/sanitation/${month}.pdf`;
}
