// MinIO, over S3's REST API with a Signature Version 4 signature. The browser never talks to the
// store: every object streams through the app, so an ended link ends file access too.

import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

const EMPTY_HASH = createHash('sha256').update('').digest('hex');

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function stamps(now: Date): { amzDate: string; day: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { amzDate, day: amzDate.slice(0, 8) };
}

function signingKey(day: string): Buffer {
  let key: Buffer = Buffer.from(`AWS4${config.store.secretAccessKey}`, 'utf8');
  for (const part of [day, config.store.region, 's3', 'aws4_request']) {
    key = createHmac('sha256', key).update(part).digest();
  }
  return key;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, path: string, query: string, payloadHash: string, extra: Record<string, string>): SignedRequest {
  const endpoint = new URL(config.store.endpoint);
  const { amzDate, day } = stamps(new Date());
  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(Object.entries(extra).map(([name, value]) => [name.toLowerCase(), value])),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [method, encodePath(path), query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${config.store.region}/s3/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');
  const signature = createHmac('sha256', signingKey(day)).update(toSign).digest('hex');
  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${config.store.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `${config.store.endpoint}${encodePath(path)}${query ? `?${query}` : ''}`,
    headers,
  };
}

async function call(
  method: string,
  path: string,
  options: { body?: Buffer; query?: string; headers?: Record<string, string>; timeout?: number } = {},
): Promise<Response> {
  const body = options.body;
  const payloadHash = body ? createHash('sha256').update(body).digest('hex') : EMPTY_HASH;
  const signed = sign(method, path, options.query ?? '', payloadHash, options.headers ?? {});
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(options.timeout ?? 10000),
    });
  } catch (error) {
    throw new StorageError(`the object store did not answer: ${(error as Error).message}`);
  }
}

function objectPath(key: string): string {
  return config.store.forcePathStyle ? `/${config.store.bucket}/${key}` : `/${key}`;
}

function bucketPath(): string {
  return config.store.forcePathStyle ? `/${config.store.bucket}` : '/';
}

function etagOf(response: Response): string {
  return (response.headers.get('etag') ?? '').replace(/"/g, '');
}

async function ensureBucket(): Promise<void> {
  const head = await call('HEAD', bucketPath(), { timeout: 5000 });
  await head.arrayBuffer().catch(() => undefined);
  if (head.ok) return;
  const made = await call('PUT', bucketPath(), { timeout: 8000 });
  await made.arrayBuffer().catch(() => undefined);
  if (!made.ok && made.status !== 409) {
    throw new StorageError(`the bucket could not be made: ${made.status}`);
  }
}

/** Writes an object, then confirms the store holds it with the hash we sent. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const written = await call('PUT', objectPath(key), {
    body,
    headers: { 'content-type': contentType },
  });
  if (!written.ok) {
    await written.text().catch(() => undefined);
    throw new StorageError(`the object store refused the write: ${written.status}`);
  }
  await written.arrayBuffer().catch(() => undefined);
  const expected = createHash('md5').update(body).digest('hex');
  if (etagOf(written) !== expected) throw new StorageError('the stored object does not match what was sent');
  const confirmed = await call('HEAD', objectPath(key), { timeout: 8000 });
  if (!confirmed.ok) throw new StorageError('the object store did not confirm the object');
  if (etagOf(confirmed) !== expected) throw new StorageError('the confirmed object does not match what was sent');
  if (Number(confirmed.headers.get('content-length')) !== body.length) {
    throw new StorageError('the confirmed object is a different size');
  }
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const found = await call('GET', objectPath(key));
  if (found.status === 404) {
    await found.arrayBuffer().catch(() => undefined);
    return null;
  }
  if (!found.ok) {
    await found.text().catch(() => undefined);
    throw new StorageError(`the object store refused the read: ${found.status}`);
  }
  return {
    body: Buffer.from(await found.arrayBuffer()),
    contentType: found.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function deleteObject(key: string): Promise<void> {
  const gone = await call('DELETE', objectPath(key), { timeout: 8000 });
  await gone.arrayBuffer().catch(() => undefined);
}

export async function storeReachable(): Promise<boolean> {
  try {
    await ensureBucket();
    return true;
  } catch {
    return false;
  }
}

export const keys = {
  original: (carId: string, uploadId: string): string => `originals/${carId}/${uploadId}`,
  derivative: (carId: string, uploadId: string): string => `derivatives/${carId}/${uploadId}.jpg`,
  report: (carId: string, version: number): string => `reports/${carId}/v${version}.pdf`,
  handover: (carId: string): string => `handover/${carId}.pdf`,
};
