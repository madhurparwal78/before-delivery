import { createHash, createHmac } from 'node:crypto';
import { config } from './config';
import { inOutage } from './outage';

/** File storage cannot be reached, or answered with a failure. */
export class StorageUnavailableError extends Error {
  constructor() {
    super('file storage is unavailable');
  }
}

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Uint8Array, data: string): Buffer => createHmac('sha256', key).update(data).digest();

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/** The address of an object, or of the bucket itself when `key` is empty: path style or virtual-hosted style. */
function addressOf(key: string): { host: string; path: string } {
  const { endpoint, bucket, forcePathStyle } = config.s3;
  const url = new URL(endpoint);
  return forcePathStyle
    ? { host: url.host, path: key === '' ? `/${bucket}` : `/${bucket}/${key}` }
    : { host: `${bucket}.${url.host}`, path: key === '' ? '/' : `/${key}` };
}

async function request(method: 'GET' | 'PUT', key: string, body: Uint8Array = new Uint8Array(), contentType?: string): Promise<Response> {
  if (inOutage('storage')) {
    throw new StorageUnavailableError();
  }
  const { endpoint, region, accessKeyId, secretAccessKey } = config.s3;
  const address = addressOf(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host: address.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) {
    headers['content-type'] = contentType;
  }
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    encodePath(address.path),
    '',
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let signingKey: Buffer = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, 's3', 'aws4_request']) {
    signingKey = hmac(signingKey, part);
  }
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  try {
    return await fetch(`${new URL(endpoint).protocol}//${address.host}${encodePath(address.path)}`, {
      method,
      headers,
      body: method === 'PUT' ? body : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new StorageUnavailableError();
  }
}

let bucketReady = false;

/** Create the bucket when it is missing. Safe to call before every write. */
export async function prepareStorage(): Promise<void> {
  if (bucketReady) {
    return;
  }
  const response = await request('PUT', '');
  await response.arrayBuffer();
  if (response.status !== 200 && response.status !== 409) {
    throw new StorageUnavailableError();
  }
  bucketReady = true;
}

export async function putObject(key: string, body: string | Uint8Array, contentType: string): Promise<void> {
  await prepareStorage();
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const response = await request('PUT', key, bytes, contentType);
  await response.arrayBuffer();
  if (!response.ok) {
    throw new StorageUnavailableError();
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await request('GET', key);
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StorageUnavailableError();
  }
  return Buffer.from(await response.arrayBuffer());
}
