import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { markService, ServiceDownError } from './health.js';

const SERVICE = 's3';
const CALL_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 4_000;
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

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

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function objectUrl(key: string): { url: URL; canonicalPath: string } {
  const base = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${key === '' ? '' : `/${key}`}`
    : `/${key}`;
  const canonicalPath = encodePath(path);
  const url = new URL(canonicalPath, base);
  if (!config.s3.forcePathStyle) url.hostname = `${config.s3.bucket}.${base.hostname}`;
  return { url, canonicalPath };
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function sign(
  method: string,
  key: string,
  payload: Buffer | null,
  extraHeaders: Record<string, string> = {},
): SignedRequest {
  const { url, canonicalPath } = objectUrl(key);
  const payloadHash = payload === null ? EMPTY_SHA256 : sha256Hex(payload);
  const { stamp, date } = amzDate(new Date());

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const names = Object.keys(headers)
    .map((n) => n.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${String(headers[name] ?? '').trim()}\n`)
    .join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method,
    canonicalPath,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    url: url.toString(),
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function down(detail: string): ServiceDownError {
  markService('storage', 'down');
  return new ServiceDownError('storage', `MinIO unreachable: ${detail}`);
}

async function send(
  method: string,
  key: string,
  payload: Buffer | null,
  extraHeaders?: Record<string, string>,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<Response> {
  const signed = sign(method, key, payload, extraHeaders);
  try {
    const response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload === null ? undefined : new Uint8Array(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 500) {
      await response.arrayBuffer();
      throw down(`status ${response.status}`);
    }
    markService('storage', 'up');
    return response;
  } catch (error) {
    if (error instanceof ServiceDownError) throw error;
    throw down(error instanceof Error ? error.message : 'network error');
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '', null);
  if (head.status === 404) await send('PUT', '', Buffer.alloc(0));
}

/**
 * Stores an object, then reads its metadata back. Returns true only when the
 * follow-up read confirms the object with the same byte length.
 */
export async function putObjectConfirmed(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<boolean> {
  const put = await send('PUT', key, body, {
    'content-type': contentType,
    'content-length': String(body.length),
  });
  if (!put.ok) {
    await put.arrayBuffer();
    return false;
  }
  const head = await send('HEAD', key, null);
  if (!head.ok) return false;
  return Number(head.headers.get('content-length') ?? '-1') === body.length;
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', key, null);
  if (!response.ok) {
    await response.arrayBuffer();
    return null;
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key, null);
  await response.arrayBuffer();
}

export async function probeStorage(): Promise<void> {
  try {
    const signed = sign('HEAD', '', null);
    const response = await fetch(signed.url, {
      method: 'HEAD',
      headers: signed.headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    markService('storage', response.status < 500 ? 'up' : 'down');
  } catch {
    markService('storage', 'down');
  }
}
