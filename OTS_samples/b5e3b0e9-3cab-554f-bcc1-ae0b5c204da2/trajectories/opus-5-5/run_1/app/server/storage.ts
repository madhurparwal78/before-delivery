import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { ApiError } from './http.js';

export class StorageError extends Error {}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function target(key: string): URL {
  const base = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) {
    return new URL(`${base.origin}/${encodePath(config.s3.bucket)}${key ? `/${encodePath(key)}` : ''}`);
  }
  return new URL(`${base.protocol}//${config.s3.bucket}.${base.host}/${encodePath(key)}`);
}

async function s3(method: string, key: string, body?: Buffer): Promise<Response> {
  const url = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? '');
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signed = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    '',
    ...signed.map((name) => `${name}:${headers[name]}`),
    '',
    signed.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`;
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, Authorization: authorization },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    throw new StorageError(error instanceof Error ? error.message : 'storage unreachable');
  }
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await s3('HEAD', '');
  if (head.status === 404) {
    const created = await s3('PUT', '');
    if (!created.ok && created.status !== 409) throw new StorageError(`bucket create failed ${created.status}`);
  } else if (!head.ok) {
    throw new StorageError(`bucket check failed ${head.status}`);
  }
  bucketReady = true;
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  await ensureBucket();
  const response = await s3('PUT', key, body);
  await response.arrayBuffer();
  if (!response.ok) throw new StorageError(`put failed ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  await ensureBucket();
  const response = await s3('GET', key);
  const data = Buffer.from(await response.arrayBuffer());
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageError(`get failed ${response.status}`);
  return data;
}

export const storageUnavailable = (message: string) =>
  new ApiError(503, { error: 'storage_unavailable', message });

export const STORAGE_MESSAGES = {
  report: 'Reports cannot be saved right now. Try again shortly.',
  layout: 'Layouts cannot be saved right now. Try again shortly.',
  layoutRead: 'Layout files cannot be read right now. Try again shortly.',
};
