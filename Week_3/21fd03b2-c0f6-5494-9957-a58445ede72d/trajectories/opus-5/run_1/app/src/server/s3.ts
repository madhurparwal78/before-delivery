import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const SERVICE = 's3';

function sha256(payload: Uint8Array | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface S3Request {
  method: 'GET' | 'PUT' | 'HEAD';
  key?: string;
  body?: Uint8Array;
  contentType?: string;
}

function endpointUrl(key: string | undefined): URL {
  const base = new URL(config.s3.endpoint);
  const path = key === undefined ? `/${config.s3.bucket}` : `/${config.s3.bucket}/${key}`;
  base.pathname = encodePath(path);
  return base;
}

async function send(request: S3Request): Promise<Response> {
  const url = endpointUrl(request.key);
  const now = new Date();
  const { stamp, date } = amzDate(now);
  const body = request.body ?? new Uint8Array(0);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (request.contentType) headers['content-type'] = request.contentType;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [
    request.method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

  const init: RequestInit = { method: request.method, headers, signal: AbortSignal.timeout(8_000) };
  if (request.method === 'PUT') init.body = body;
  return fetch(url, init);
}

export class StorageDown extends Error {}

async function attempt(request: S3Request): Promise<Response> {
  try {
    return await send(request);
  } catch {
    throw new StorageDown('file storage is unreachable');
  }
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const response = await attempt({ method: 'PUT', key, body, contentType });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageDown(`storage rejected the write with ${response.status}`);
  }
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  const response = await attempt({ method: 'GET', key });
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }
  if (!response.ok) throw new StorageDown(`storage rejected the read with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send({ method: 'HEAD' });
    await response.arrayBuffer().catch(() => undefined);
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send({ method: 'HEAD' });
  await head.arrayBuffer().catch(() => undefined);
  if (head.status === 404) {
    const created = await send({ method: 'PUT' });
    await created.arrayBuffer().catch(() => undefined);
  }
}

export const storageKeys = {
  asset: (projectId: string, sha256Hex: string) => `assets/${projectId}/${sha256Hex}`,
  checkpoint: (sceneId: string, checkpointId: string) =>
    `checkpoints/${sceneId}/${checkpointId}.json`,
  bundle: (sceneId: string, bundleHash: string) => `labs/${sceneId}/${bundleHash}.json`,
};
