import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

const STORAGE_TIMEOUT_MS = 2500;
const SERVICE = 's3';

export class StorageUnavailable extends Error {}

function hashHex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeSegment(segment))
    .join('/');
}

interface SignedRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: string;
  readonly body?: Buffer;
  readonly headers?: Record<string, string>;
}

function signRequest(request: SignedRequest): { url: string; headers: Record<string, string> } {
  const now = new Date();
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = stamp.slice(0, 8);
  const endpoint = new URL(config.storage.endpoint);
  const path = canonicalPath(request.path);
  const payloadHash = hashHex(request.body ?? Buffer.alloc(0));
  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...Object.fromEntries(
      Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    ),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    request.method,
    path,
    request.query ?? '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.storage.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    hashHex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, date), config.storage.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const query = request.query !== undefined && request.query !== '' ? `?${request.query}` : '';
  return { url: `${config.storage.endpoint}${path}${query}`, headers };
}

async function send(request: SignedRequest): Promise<Response> {
  const { url, headers } = signRequest(request);
  try {
    return await fetch(url, {
      method: request.method,
      headers,
      body: request.body,
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageUnavailable(error instanceof Error ? error.message : 'storage request failed');
  }
}

function objectPath(key: string): string {
  return `/${config.storage.bucket}/${key}`;
}

export async function ensureBucket(): Promise<void> {
  const head = await send({ method: 'HEAD', path: `/${config.storage.bucket}` });
  if (head.ok) return;
  const created = await send({ method: 'PUT', path: `/${config.storage.bucket}` });
  if (!created.ok && created.status !== 409) {
    throw new StorageUnavailable(`could not create bucket (${created.status})`);
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  metadata: Record<string, string> = {},
): Promise<void> {
  const headers: Record<string, string> = {
    'content-type': contentType,
    'content-length': String(body.length),
  };
  for (const [name, value] of Object.entries(metadata)) {
    headers[`x-amz-meta-${name}`] = value;
  }
  const response = await send({ method: 'PUT', path: objectPath(key), body, headers });
  if (!response.ok) throw new StorageUnavailable(`put failed (${response.status})`);
}

export interface ObjectHead {
  readonly size: number;
  readonly metadata: Record<string, string>;
}

export async function headObject(key: string): Promise<ObjectHead | null> {
  const response = await send({ method: 'HEAD', path: objectPath(key) });
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`head failed (${response.status})`);
  const metadata: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith('x-amz-meta-')) {
      metadata[name.toLowerCase().slice('x-amz-meta-'.length)] = value;
    }
  });
  return { size: Number(response.headers.get('content-length') ?? '0'), metadata };
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send({ method: 'GET', path: objectPath(key) });
  if (!response.ok) throw new StorageUnavailable(`get failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send({ method: 'DELETE', path: objectPath(key) });
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(`delete failed (${response.status})`);
  }
}

export const evidenceKeys = (figureId: string) => ({
  readings: `figures/${figureId}/readings.csv`,
  derivation: `figures/${figureId}/derivation.json`,
});
