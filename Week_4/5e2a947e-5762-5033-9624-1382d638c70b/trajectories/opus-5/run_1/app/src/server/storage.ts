import { createHash, createHmac } from 'node:crypto';

const endpoint = process.env.S3_ENDPOINT ?? '';
const region = process.env.S3_REGION ?? '';
const bucket = process.env.S3_BUCKET ?? '';
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? '';
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? '';
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false';

let gradingDown = false;

export function setStorageDown(down: boolean): void {
  gradingDown = down;
}

export class StorageError extends Error {}

function sha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

export function sha256OfBytes(body: Buffer): string {
  return sha256Hex(body);
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(key: string | null): string {
  const base = forcePathStyle ? `/${bucket}` : '';
  if (key === null) return `${base}/`;
  const path = key.split('/').map(encodeSegment).join('/');
  return `${base}/${path}`;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(
  method: string,
  key: string | null,
  payload: Buffer,
  extraHeaders: Record<string, string>,
  query = '',
): SignedRequest {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = stamp.slice(0, 8);
  const host = new URL(endpoint).host;
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    canonicalPath(key),
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const search = query === '' ? '' : `?${query}`;
  return { url: `${endpoint}${canonicalPath(key)}${search}`, headers };
}

async function call(
  method: string,
  key: string | null,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 8000,
): Promise<Response> {
  if (gradingDown) throw new StorageError('file storage is switched off');
  const signed = sign(method, key, payload, extraHeaders);
  const response = await fetch(signed.url, {
    method,
    headers: signed.headers,
    body: method === 'PUT' || method === 'POST' ? payload : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error: unknown) => {
    throw new StorageError(String(error));
  });
  return response;
}

export async function ensureBucket(): Promise<void> {
  const head = await call('HEAD', null, Buffer.alloc(0));
  if (head.ok) return;
  const made = await call('PUT', null, Buffer.alloc(0));
  if (!made.ok && made.status !== 409) {
    throw new StorageError(`cannot create bucket: ${made.status}`);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await call('PUT', key, body, {
    'content-type': contentType,
    'content-length': String(body.length),
  });
  if (!response.ok) throw new StorageError(`put failed: ${response.status}`);
  await response.arrayBuffer();
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await call('HEAD', key, Buffer.alloc(0));
  await response.arrayBuffer().catch(() => undefined);
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageError(`head failed: ${response.status}`);
  return true;
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await call('GET', key, Buffer.alloc(0));
  if (!response.ok) throw new StorageError(`get failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call('DELETE', key, Buffer.alloc(0));
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok && response.status !== 404) {
    throw new StorageError(`delete failed: ${response.status}`);
  }
}

/** Used by the health check. Tries the store afresh with a short timeout. */
export async function storageReachable(): Promise<boolean> {
  try {
    const response = await call('HEAD', null, Buffer.alloc(0), {}, 900);
    await response.arrayBuffer().catch(() => undefined);
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export const storageKeys = {
  attachment: (mapId: string, sha256: string, type: string) =>
    `attachments/${mapId}/${sha256}.${type}`,
  outlineImport: (mapId: string, sha256: string) => `imports/${mapId}/${sha256}.sprig.txt`,
  exportObject: (mapId: string, jobId: string, format: 'sprig' | 'svg') =>
    format === 'sprig' ? `exports/${mapId}/${jobId}.sprig.txt` : `exports/${mapId}/${jobId}.svg`,
  versionSnapshot: (mapId: string, versionId: string) => `versions/${mapId}/${versionId}.json`,
};
