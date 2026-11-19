import { createHash, createHmac } from 'node:crypto';
import { config } from './config';
import { storageUnavailable } from './errors';

const { s3 } = config;
const TIMEOUT_MS = 4000;

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

interface Reply { status: number; headers: Headers; body: Buffer }

async function send(method: string, key: string, payload: Buffer = Buffer.alloc(0), extra: Record<string, string> = {}, timeoutMs = TIMEOUT_MS): Promise<Reply> {
  const url = new URL(s3.endpoint);
  const objectPath = key === '' ? '' : `/${key}`;
  const host = s3.pathStyle ? url.host : `${s3.bucket}.${url.host}`;
  const path = s3.pathStyle ? `/${s3.bucket}${objectPath}` : objectPath || '/';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(payload).digest('hex');
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extra };
  const names = Object.keys(headers).sort();
  const canonical = [
    method, encodePath(path), '', names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), payloadHash,
  ].join('\n');
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${s3.secretAccessKey}`, day), s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  const { host: _host, ...sendable } = headers;
  try {
    const response = await fetch(`${url.protocol}//${host}${encodePath(path)}`, {
      method,
      headers: sendable,
      body: method === 'PUT' ? new Uint8Array(payload) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
  } catch {
    throw storageUnavailable();
  }
}

export const modelKey = (modelId: string) => `models/${modelId}.glb`;

/** Stores an object and returns only after MinIO confirmed its byte length and SHA-256. */
export async function putConfirmed(key: string, bytes: Buffer, sha256: string): Promise<void> {
  const checksum = Buffer.from(sha256, 'hex').toString('base64');
  let put = await send('PUT', key, bytes, { 'x-amz-checksum-sha256': checksum });
  if (put.status === 404 && put.body.toString().includes('NoSuchBucket')) {
    await send('PUT', '');
    put = await send('PUT', key, bytes, { 'x-amz-checksum-sha256': checksum });
  }
  if (put.status !== 200) throw storageUnavailable();
  const echoed = put.headers.get('x-amz-checksum-sha256');
  const head = await send('HEAD', key, Buffer.alloc(0), { 'x-amz-checksum-mode': 'ENABLED' });
  const stored = head.headers.get('x-amz-checksum-sha256');
  if (head.status !== 200 || Number(head.headers.get('content-length')) !== bytes.length || (echoed ?? checksum) !== checksum || (stored ?? checksum) !== checksum)
    throw storageUnavailable();
}

export async function objectLength(key: string): Promise<number | null> {
  const head = await send('HEAD', key);
  return head.status === 200 ? Number(head.headers.get('content-length')) : null;
}

export async function getObject(key: string): Promise<Buffer | null> {
  const reply = await send('GET', key, Buffer.alloc(0), {}, 15000);
  if (reply.status === 200) return reply.body;
  if (reply.status === 404) return null;
  throw storageUnavailable();
}

export async function deleteObject(key: string): Promise<void> {
  await send('DELETE', key);
}

export async function storageAnswers(): Promise<boolean> {
  try {
    const reply = await send('HEAD', '', Buffer.alloc(0), {}, 2500);
    return reply.status === 200 || reply.status === 404;
  } catch {
    return false;
  }
}
