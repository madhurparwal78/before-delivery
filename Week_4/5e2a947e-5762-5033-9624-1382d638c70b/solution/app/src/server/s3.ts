import { createHash, createHmac } from 'node:crypto';
import { signingTime } from './clock.ts';
import { config } from './config.ts';

/** Thrown whenever the object store cannot be reached or refuses a call. */
export class StorageError extends Error {}

let forcedDown = false;

/** The grading storage switch: while down, every call fails as if the store were unreachable. */
export const setStorageDown = (down: boolean): void => {
  forcedDown = down;
};

const sha256Hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

const uriEncode = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface Signed {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, key: string | null, body: Uint8Array, contentType: string | null): Signed {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const target = config.s3.forcePathStyle ? base : new URL(`${base.protocol}//${bucket}.${base.host}`);
  const path = `/${[...(config.s3.forcePathStyle ? [bucket] : []), ...(key ? key.split('/') : [])].map(uriEncode).join('/')}`;
  const now = signingTime();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payload = sha256Hex(body);
  const headers: Record<string, string> = { host: target.host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    path,
    '',
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    payload,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return { url: `${target.origin}${path}`, headers };
}

async function call(
  method: string,
  key: string | null,
  options: { body?: Uint8Array; contentType?: string; timeoutMs?: number } = {},
): Promise<Response> {
  if (forcedDown) throw new StorageError('File storage is unavailable.');
  const body = options.body ?? new Uint8Array();
  const signed = sign(method, key, body, options.contentType ?? null);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' && body.length > 0 ? body : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 4000),
    });
  } catch {
    throw new StorageError('File storage is unavailable.');
  }
}

async function createBucket(): Promise<void> {
  const response = await call('PUT', null);
  if (!response.ok && response.status !== 409) throw new StorageError('File storage is unavailable.');
}

/** Create the bucket when it is missing. Failure is reported but never stops the app. */
export async function ensureBucket(): Promise<void> {
  const head = await call('HEAD', null);
  if (head.status === 404) await createBucket();
  else if (!head.ok) throw new StorageError('File storage is unavailable.');
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  let response = await call('PUT', key, { body, contentType });
  if (response.status === 404) {
    await createBucket();
    response = await call('PUT', key, { body, contentType });
  }
  if (!response.ok) throw new StorageError('File storage is unavailable.');
}

export async function getObject(key: string): Promise<Uint8Array> {
  const response = await call('GET', key);
  if (!response.ok) throw new StorageError('File storage is unavailable.');
  return new Uint8Array(await response.arrayBuffer());
}

/** True when the object exists; a failed call is an error, never a false answer. */
export async function objectExists(key: string): Promise<boolean> {
  const response = await call('HEAD', key);
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageError('File storage is unavailable.');
  return true;
}

/** The health answer: a real request to the store with a one second timeout. */
export async function storageReachable(): Promise<boolean> {
  try {
    const response = await call('HEAD', null, { timeoutMs: 1000 });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
