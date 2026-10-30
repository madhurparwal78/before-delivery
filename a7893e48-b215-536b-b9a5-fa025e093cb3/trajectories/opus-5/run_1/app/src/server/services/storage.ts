import { createHash, createHmac } from 'node:crypto';
import { env } from '../env.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 8_000;

function hash(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  objectPath: string,
  payload: Buffer,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const base = new URL(env.storage.endpoint);
  const canonicalPath = env.storage.forcePathStyle
    ? `/${env.storage.bucket}${objectPath === '' ? '' : `/${encodePath(objectPath)}`}`
    : `/${encodePath(objectPath)}`;
  const { amzDate, dateStamp } = stamps(new Date());
  const payloadHash = hash(payload);
  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${String(headers[name] ?? '').trim()}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [
    method,
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${env.storage.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${env.storage.secretAccessKey}`, dateStamp), env.storage.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `${ALGORITHM} Credential=${env.storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const hostPrefix = env.storage.forcePathStyle ? '' : `${env.storage.bucket}.`;
  return {
    url: `${base.protocol}//${hostPrefix}${base.host}${canonicalPath}`,
    headers,
  };
}

async function send(
  method: string,
  objectPath: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, objectPath, payload, extraHeaders);
  return fetch(signed.url, {
    method,
    headers: signed.headers,
    body: method === 'PUT' ? payload : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '', Buffer.alloc(0));
  if (head.ok) return;
  const created = await send('PUT', '', Buffer.alloc(0));
  if (!created.ok && created.status !== 409) {
    throw new Error(`cannot create bucket ${env.storage.bucket}: ${created.status}`);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', key, body, { 'content-type': contentType });
  if (!response.ok) throw new Error(`storage put failed for ${key}: ${response.status}`);
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const response = await send('GET', key, Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`storage get failed for ${key}: ${response.status}`);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', key, Buffer.alloc(0));
  return response.ok;
}
