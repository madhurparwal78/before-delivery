import { createHash, createHmac } from 'node:crypto';
import { env } from '../env';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(method: string, objectPath: string, payload: Buffer | null): SignedRequest {
  const base = new URL(env.storage.endpoint);
  const canonicalPath = encodePath(env.storage.forcePathStyle ? `/${env.storage.bucket}${objectPath}` : objectPath);
  const host = env.storage.forcePathStyle ? base.host : `${env.storage.bucket}.${base.host}`;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = payload ? sha256(payload) : EMPTY_SHA256;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join('');
  const canonicalRequest = [method, canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${env.storage.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${env.storage.secretAccessKey}`, dateStamp), env.storage.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${env.storage.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `${base.origin}${canonicalPath}`;
  return { url, headers };
}

export class StorageDown extends Error {}

async function send(method: string, objectPath: string, payload: Buffer | null, contentType?: string): Promise<Response> {
  const signed = signRequest(method, objectPath, payload);
  const headers: Record<string, string> = { ...signed.headers };
  if (contentType) headers['Content-Type'] = contentType;
  try {
    return await fetch(signed.url, {
      method,
      headers,
      body: payload ?? undefined,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new StorageDown('object storage unreachable');
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', `/${key}`, body, contentType);
  if (!response.ok) throw new StorageDown(`object storage refused the write (${response.status})`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send('GET', `/${key}`, null);
  if (!response.ok) throw new StorageDown(`object storage refused the read (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', `/${key}`, null);
  if (!response.ok && response.status !== 404) throw new StorageDown('object storage refused the delete');
}

export async function storageIsUp(): Promise<boolean> {
  try {
    const response = await send('HEAD', '/', null);
    return response.status < 500;
  } catch {
    return false;
  }
}
