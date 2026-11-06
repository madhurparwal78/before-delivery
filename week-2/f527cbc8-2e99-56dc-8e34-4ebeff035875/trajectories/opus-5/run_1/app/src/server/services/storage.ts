import { createHash, createHmac } from 'node:crypto';
import { config, limits } from '../config.js';
import { withTimeout } from '../util.js';

/**
 * The private MinIO bucket. Only the five operations the app needs are implemented,
 * each signed with S3 SigV4 and carrying an explicit timeout. Browsers never talk to
 * MinIO: every object reaches them through a signed `/media/` path this server serves.
 */
export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('object storage is unreachable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

function hash(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function amzDate(instant: Date): { stamp: string; date: string } {
  const stamp = instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, key: string, payload: Buffer, extraHeaders: Record<string, string>): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${encodeKey(key)}`
    : `/${encodeKey(key)}`;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const { stamp, date } = amzDate(new Date());
  const payloadHash = hash(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };

  const signedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${String(headers[name] ?? headers[Object.keys(headers).find((k) => k.toLowerCase() === name) as string]).trim()}\n`)
    .join('');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedNames.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedNames.join(';')}, Signature=${signature}`;

  return { url: `${endpoint.origin}${path}`, headers };
}

async function send(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, key, payload, extraHeaders);
  try {
    return await withTimeout(limits.providerTimeoutMs, (signal) =>
      fetch(signed.url, {
        method,
        headers: signed.headers,
        body: method === 'PUT' ? new Uint8Array(payload) : undefined,
        signal,
      }),
    );
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', key, body, {
    'content-type': contentType,
    'content-length': String(body.length),
  });
  if (!response.ok) throw new StorageUnavailable(`PUT ${key} answered ${response.status}`);
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', key, Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`GET ${key} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key, Buffer.alloc(0));
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(`DELETE ${key} answered ${response.status}`);
  }
  await response.arrayBuffer();
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', key, Buffer.alloc(0));
  await response.arrayBuffer();
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageUnavailable(`HEAD ${key} answered ${response.status}`);
  return true;
}

export async function ensureBucket(): Promise<void> {
  const endpoint = new URL(config.s3.endpoint);
  const probe = sign('HEAD', '', Buffer.alloc(0), {});
  const response = await withTimeout(limits.providerTimeoutMs, (signal) =>
    fetch(`${endpoint.origin}/${config.s3.bucket}`, { method: 'HEAD', headers: probe.headers, signal }),
  ).catch((error: unknown) => {
    throw new StorageUnavailable(error);
  });
  await response.arrayBuffer();
  if (response.status === 404) {
    const create = sign('PUT', '', Buffer.alloc(0), { 'content-length': '0' });
    const made = await withTimeout(limits.providerTimeoutMs, (signal) =>
      fetch(`${endpoint.origin}/${config.s3.bucket}`, {
        method: 'PUT',
        headers: create.headers,
        signal,
      }),
    );
    await made.arrayBuffer();
  }
}

export async function storageHealthy(timeoutMs: number): Promise<boolean> {
  const endpoint = new URL(config.s3.endpoint);
  try {
    const response = await withTimeout(timeoutMs, (signal) =>
      fetch(`${endpoint.origin}/minio/health/live`, { signal }),
    );
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

export const objectKeys = {
  photo: (visitId: string, hoof: string, phase: string, photoId: string, extension: string): string =>
    `visits/${visitId}/${hoof}/${phase}/${photoId}.${extension}`,
  thumbnail: (visitId: string, hoof: string, phase: string, photoId: string): string =>
    `visits/${visitId}/${hoof}/${phase}/${photoId}.thumb.jpg`,
  uploadChunk: (uploadId: string, index: number): string => `uploads/${uploadId}/${index}`,
  export: (month: string, jobId: string): string => `exports/${month}/${jobId}.csv`,
};
