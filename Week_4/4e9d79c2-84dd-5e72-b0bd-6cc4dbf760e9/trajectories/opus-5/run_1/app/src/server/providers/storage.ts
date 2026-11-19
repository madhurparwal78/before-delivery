import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

const TIMEOUT_MS = 5000;

export class StorageDown extends Error {}

function sha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function signingKey(date: string): Buffer {
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

type SignedRequest = { url: string; headers: Record<string, string> };

function sign(method: string, path: string, body: Buffer, extra: Record<string, string> = {}): SignedRequest {
  const base = new URL(config.s3.endpoint);
  const url = new URL(`${base.origin}${path}`);
  const now = new Date();
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = stamp.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extra,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(date)).update(toSign).digest('hex');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: url.toString(), headers };
}

async function call(method: string, path: string, body: Buffer, extra: Record<string, string> = {}): Promise<Response> {
  const signed = sign(method, path, body, extra);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StorageDown('the file store did not answer');
  }
}

function objectPath(key: string): string {
  const encoded = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return config.s3.forcePathStyle ? `/${config.s3.bucket}/${encoded}` : `/${encoded}`;
}

export async function ensureBucket(): Promise<void> {
  const path = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '/';
  const head = await call('HEAD', path, Buffer.alloc(0));
  if (head.status === 404) {
    const made = await call('PUT', path, Buffer.alloc(0));
    if (!made.ok && made.status !== 409) throw new StorageDown(`bucket not made: ${made.status}`);
    return;
  }
  if (!head.ok) throw new StorageDown(`bucket not reached: ${head.status}`);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const answer = await call('PUT', objectPath(key), body, { 'content-type': contentType });
  if (!answer.ok) {
    if (answer.status === 404) {
      await ensureBucket();
      const again = await call('PUT', objectPath(key), body, { 'content-type': contentType });
      if (again.ok) return;
    }
    throw new StorageDown(`put failed: ${answer.status}`);
  }
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const answer = await call('GET', objectPath(key), Buffer.alloc(0));
  if (answer.status === 404) return null;
  if (!answer.ok) throw new StorageDown(`get failed: ${answer.status}`);
  const body = Buffer.from(await answer.arrayBuffer());
  return { body, contentType: answer.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function deleteObject(key: string): Promise<void> {
  const answer = await call('DELETE', objectPath(key), Buffer.alloc(0));
  if (!answer.ok && answer.status !== 404) throw new StorageDown(`delete failed: ${answer.status}`);
}

/** Asked before an erasure even when a customer has no files, so an outage keeps it Erasing. */
export async function reachStore(): Promise<void> {
  await ensureBucket();
}
