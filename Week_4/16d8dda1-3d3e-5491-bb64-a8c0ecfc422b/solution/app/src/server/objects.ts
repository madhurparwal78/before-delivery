// MinIO: lesson files under `lessons/<lessonId>/<fileId>` through a minimal SigV4 client.
import { createHash, createHmac } from 'node:crypto';
import { config } from './config';

export class StorageDown extends Error {}

let flaggedDown = false;
let probed = { at: 0, ok: false };

export function setStorageOutage(down: boolean): void {
  flaggedDown = down;
  probed = { at: 0, ok: false };
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

function target(key: string): URL {
  const endpoint = new URL(config.s3.endpoint);
  const path = key === '' ? '' : `/${key.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
  if (config.s3.forcePathStyle) return new URL(`${endpoint.origin}/${config.s3.bucket}${path}`);
  return new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}${path}`);
}

function signedHeaders(method: string, url: URL, payload: Buffer | null): Record<string, string> {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(payload ?? '');
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const canonical = [
    method,
    url.pathname,
    '',
    `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`,
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signingKey = [day, config.s3.region, 's3', 'aws4_request'].reduce<Buffer | string>(
    (key, part) => hmac(key, part),
    `AWS4${config.s3.secretAccessKey}`,
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return {
    'x-amz-date': stamp,
    'x-amz-content-sha256': payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
  };
}

async function call(method: string, key: string, body: Buffer | null = null, contentType?: string): Promise<Response> {
  if (flaggedDown) throw new StorageDown('flagged down');
  const url = target(key);
  const headers = signedHeaders(method, url, body);
  if (contentType) headers['content-type'] = contentType;
  try {
    return await fetch(url, { method, headers, body: body ? new Uint8Array(body) : null, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new StorageDown(error instanceof Error ? error.message : 'unreachable');
  }
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  const response = await call('PUT', key, data, contentType);
  await response.arrayBuffer();
  if (!response.ok) throw new StorageDown(`put answered ${response.status}`);
}

/** The stored byte count, or null when the object is not there. */
export async function storedBytes(key: string): Promise<number | null> {
  const response = await call('HEAD', key);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageDown(`head answered ${response.status}`);
  return Number(response.headers.get('content-length'));
}

export async function getObject(key: string): Promise<Response> {
  const response = await call('GET', key);
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StorageDown(`get answered ${response.status}`);
  }
  return response;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call('DELETE', key);
  await response.arrayBuffer();
  if (!response.ok && response.status !== 404) throw new StorageDown(`delete answered ${response.status}`);
}

/** True while the bucket answers; read by health and by the uploads' first check. */
export async function storageIsUp(): Promise<boolean> {
  if (flaggedDown) return false;
  if (Date.now() - probed.at < 1000) return probed.ok;
  try {
    const response = await call('HEAD', '');
    await response.arrayBuffer();
    probed = { at: Date.now(), ok: response.ok };
  } catch {
    probed = { at: Date.now(), ok: false };
  }
  return probed.ok;
}

export function lessonFileKey(lessonId: string, fileId: string): string {
  return `lessons/${lessonId}/${fileId}`;
}
