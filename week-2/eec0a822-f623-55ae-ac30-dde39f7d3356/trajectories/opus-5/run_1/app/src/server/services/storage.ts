import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageUnreachable extends Error {}

const SERVICE = 's3';

function amzDate(now: Date): { long: string; short: string } {
  const long = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { long, short: long.slice(0, 8) };
}

function hash(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function sign(
  method: string,
  objectPath: string,
  queryString: string,
  payload: Buffer | null,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const base = new URL(config.s3.endpoint);
  const canonicalPath = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${objectPath === '' ? '' : `/${encodePath(objectPath)}`}`
    : objectPath === ''
      ? '/'
      : `/${encodePath(objectPath)}`;
  const host = config.s3.forcePathStyle ? base.host : `${config.s3.bucket}.${base.host}`;
  const { long, short } = amzDate(new Date());
  const payloadHash = payload === null ? hash('') : hash(payload);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': long,
    ...extraHeaders,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${String(headers[name] ?? headers[name.toLowerCase()]).trim()}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    canonicalPath,
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${short}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', long, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, short), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `${base.protocol}//${base.host}${canonicalPath}${queryString === '' ? '' : `?${queryString}`}`;
  return { url, headers };
}

async function send(
  method: string,
  objectPath: string,
  payload: Buffer | null,
  extraHeaders: Record<string, string> = {},
  queryString = '',
): Promise<Response> {
  const signed = sign(method, objectPath, queryString, payload, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload === null ? undefined : new Uint8Array(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StorageUnreachable('MinIO is unreachable');
  }
}

let bucketReady = false;

/** Creates the bucket when missing, tried afresh until it succeeds. */
export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await send('HEAD', '', null);
  await head.arrayBuffer();
  if (head.status === 404) {
    const created = await send('PUT', '', Buffer.alloc(0));
    await created.arrayBuffer();
    if (!created.ok) throw new StorageUnreachable(`MinIO refused the bucket: ${created.status}`);
  } else if (!head.ok) {
    throw new StorageUnreachable(`MinIO refused the bucket: ${head.status}`);
  }
  bucketReady = true;
}

export async function putObject(
  key: string,
  content: Buffer,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  const response = await send('PUT', key, content, {
    'content-type': contentType,
    'content-length': String(content.length),
  });
  if (!response.ok) throw new StorageUnreachable(`MinIO refused ${response.status}`);
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', key, null);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnreachable(`MinIO refused ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key, null);
  if (!response.ok && response.status !== 404) {
    throw new StorageUnreachable(`MinIO refused ${response.status}`);
  }
  await response.arrayBuffer();
}
