import { createHash, createHmac } from 'node:crypto';
import { env } from './env.js';

export class StorageError extends Error {}

const TIMEOUT_MS = 5_000;

function sha256Hex(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function objectUrl(key: string): URL {
  const base = new URL(env.s3Endpoint);
  const path = env.s3ForcePathStyle
    ? `${base.pathname.replace(/\/$/, '')}/${env.s3Bucket}/${key}`
    : `${base.pathname.replace(/\/$/, '')}/${key}`;
  const url = new URL(base.toString());
  if (!env.s3ForcePathStyle) url.host = `${env.s3Bucket}.${base.host}`;
  url.pathname = path;
  return url;
}

function signedHeaders(method: 'GET' | 'PUT' | 'DELETE', key: string, body: string, contentType?: string): { url: URL; headers: Record<string, string> } {
  const url = objectUrl(key);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaderList = names.join(';');
  const canonicalRequest = [
    method,
    url.pathname.split('/').map((part) => encodeURIComponent(part)).join('/'),
    '',
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${env.s3Region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env.s3SecretAccessKey}`, dateStamp), env.s3Region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers['authorization'] = `AWS4-HMAC-SHA256 Credential=${env.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;
  return { url, headers };
}

async function send(method: 'GET' | 'PUT' | 'DELETE', key: string, body: string, contentType?: string): Promise<Response> {
  const { url, headers } = signedHeaders(method, key, body, contentType);
  try {
    return await fetch(url, {
      method,
      headers,
      body: method === 'PUT' ? body : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StorageError('storage unreachable');
  }
}

export function objectKey(documentId: string): string {
  return `documents/${documentId}.json`;
}

export async function putObject(documentId: string, body: string): Promise<void> {
  const response = await send('PUT', objectKey(documentId), body, 'application/json');
  if (!response.ok) throw new StorageError(`storage write failed with ${response.status}`);
}

export async function getObject(documentId: string): Promise<string | null> {
  const response = await send('GET', objectKey(documentId), '');
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageError(`storage read failed with ${response.status}`);
  return response.text();
}

export async function deleteObject(documentId: string): Promise<void> {
  const response = await send('DELETE', objectKey(documentId), '');
  if (!response.ok && response.status !== 404) throw new StorageError(`storage delete failed with ${response.status}`);
}

export async function objectExists(documentId: string): Promise<boolean> {
  const response = await send('GET', objectKey(documentId), '');
  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }
  if (!response.ok) throw new StorageError(`storage read failed with ${response.status}`);
  await response.body?.cancel();
  return true;
}
