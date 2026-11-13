import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function amzDate(now: Date): { long: string; short: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { long: iso, short: iso.slice(0, 8) };
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

type SignedRequest = { url: string; headers: Record<string, string> };

function sign(method: string, key: string, payloadHash: string, extraHeaders: Record<string, string>): SignedRequest {
  const endpoint = new URL(config.s3Endpoint);
  const path = config.s3ForcePathStyle
    ? `/${config.s3Bucket}/${encodePath(key)}`
    : `/${encodePath(key)}`;
  const host = config.s3ForcePathStyle ? endpoint.host : `${config.s3Bucket}.${endpoint.host}`;
  const { long, short } = amzDate(new Date());

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': long,
    ...extraHeaders
  };

  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowered: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) lowered[name.toLowerCase()] = String(value).trim();

  const canonicalHeaders = sortedNames.map((name) => `${name}:${lowered[name]}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${short}/${config.s3Region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    long,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3SecretAccessKey}`, short), config.s3Region), 's3'),
    'aws4_request'
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${endpoint.origin}${path}`, headers };
}

async function request(
  method: string,
  key: string,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const payloadHash = body === null ? EMPTY_SHA256 : createHash('sha256').update(body).digest('hex');
  const headers = { ...extraHeaders };
  if (body !== null) headers['content-length'] = String(body.length);
  const signed = sign(method, key, payloadHash, headers);
  return fetch(signed.url, {
    method,
    headers: signed.headers,
    body: body === null ? undefined : new Uint8Array(body),
    signal: AbortSignal.timeout(8000)
  });
}

export async function ensureBucket(): Promise<void> {
  const endpoint = new URL(config.s3Endpoint);
  const { long, short } = amzDate(new Date());
  const path = `/${config.s3Bucket}`;
  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': EMPTY_SHA256,
    'x-amz-date': long
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = ['PUT', path, '', canonicalHeaders, signedHeaders, EMPTY_SHA256].join('\n');
  const scope = `${short}/${config.s3Region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    long,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3SecretAccessKey}`, short), config.s3Region), 's3'),
    'aws4_request'
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  await fetch(`${endpoint.origin}${path}`, {
    method: 'PUT',
    headers,
    signal: AbortSignal.timeout(5000)
  }).catch(() => undefined);
}

/**
 * Writes the object and reads its size back. The caller may only record the
 * upload once this resolves true, which is what makes an upload "confirmed".
 */
export async function putConfirmed(key: string, body: Buffer, contentType: string): Promise<boolean> {
  try {
    const put = await request('PUT', key, body, { 'content-type': contentType });
    if (!put.ok) return false;
    const head = await request('HEAD', key, null);
    if (!head.ok) return false;
    const length = head.headers.get('content-length');
    return length !== null && Number(length) === body.length;
  } catch {
    return false;
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const response = await request('GET', key, null);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    const endpoint = new URL(config.s3Endpoint);
    const response = await fetch(`${endpoint.origin}/minio/health/live`, {
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch {
    return false;
  }
}
