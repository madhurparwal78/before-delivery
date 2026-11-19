import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { AppError } from './errors.js';

const REQUEST_TIMEOUT_MS = 8000;

export const storageUnavailable = (): AppError =>
  new AppError('STORAGE_UNAVAILABLE', 'Image storage is unavailable right now');

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encodePath = (path: string): string => path.split('/').map((s) => encodeURIComponent(s)).join('/');

interface Target { url: URL; path: string }

function target(key: string): Target {
  const { endpoint, bucket, forcePathStyle } = config.s3;
  if (!endpoint || !bucket) throw storageUnavailable();
  const base = new URL(endpoint);
  if (forcePathStyle) {
    const path = `/${bucket}${key ? `/${key}` : ''}`;
    return { url: new URL(encodePath(path), base), path: encodePath(path) };
  }
  base.hostname = `${bucket}.${base.hostname}`;
  const path = `/${key}`;
  return { url: new URL(encodePath(path), base), path: encodePath(path) };
}

/** Signs and sends one S3 request (Signature Version 4). Network faults surface as STORAGE_UNAVAILABLE. */
async function send(method: 'GET' | 'HEAD' | 'PUT', key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const { region, accessKeyId, secretAccessKey } = config.s3;
  if (!region || !accessKeyId || !secretAccessKey) throw storageUnavailable();
  const { url, path } = target(key);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  const signedNames = Object.keys(headers).sort();
  const canonical = [
    method, path, '', signedNames.map((n) => `${n}:${headers[n]}\n`).join(''), signedNames.join(';'), payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`;
  const { host: _host, ...sendable } = headers;
  try {
    return await fetch(url, {
      method,
      headers: { ...sendable, authorization, ...(contentType ? { 'content-type': contentType } : {}) },
      body: method === 'PUT' ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw storageUnavailable();
  }
}

let bucketReady = false;

export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await send('HEAD', '');
  if (head.status === 404) {
    const created = await send('PUT', '');
    if (created.status !== 200 && created.status !== 409) throw storageUnavailable();
  } else if (head.status !== 200) {
    throw storageUnavailable();
  }
  bucketReady = true;
}

export async function storageAnswers(): Promise<boolean> {
  try {
    await ensureBucket();
    return true;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const response = await send('PUT', key, body, contentType);
  if (!response.ok) throw storageUnavailable();
}

/** True when the object exists; throws STORAGE_UNAVAILABLE when storage cannot answer. */
export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', key);
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw storageUnavailable();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', key);
  if (response.status === 404) return null;
  if (!response.ok) throw storageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}
