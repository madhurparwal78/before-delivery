import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const TIMEOUT_MS = 5000;

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encodePath = (path: string): string => path.split('/').map((part) => encodeURIComponent(part)).join('/');

async function signedRequest(method: 'PUT' | 'HEAD' | 'GET', key: string, body: Buffer, contentType?: string): Promise<Response> {
  const { endpoint, bucket, region, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}/${key}` : `/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [
    method,
    encodePath(path),
    '',
    Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = ['aws4_request', 's3', region, day].reduceRight<Buffer | string>((key2, part) => hmac(key2, part), `AWS4${secretAccessKey}`);
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(`${base.protocol}//${host}${encodePath(path)}`, {
    method,
    headers: { ...headers, Authorization: authorization, ...(contentType ? { 'Content-Type': contentType } : {}) },
    ...(method === 'PUT' ? { body } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const response = await signedRequest('PUT', key, bytes, contentType);
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`object store answered ${response.status}`);
}

export async function objectSize(key: string): Promise<number | null> {
  const response = await signedRequest('HEAD', key, Buffer.alloc(0));
  if (!response.ok) return null;
  return Number(response.headers.get('content-length'));
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await signedRequest('GET', key, Buffer.alloc(0));
  if (!response.ok) throw new Error(`object store answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
