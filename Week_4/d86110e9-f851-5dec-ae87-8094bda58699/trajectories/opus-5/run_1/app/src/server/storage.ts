import { createHash, createHmac } from 'node:crypto';
import { config } from './config';

const SERVICE = 's3';
const TIMEOUT_MS = 4000;

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface S3Response {
  status: number;
  body: Buffer;
}

async function s3Request(method: 'PUT' | 'GET' | 'HEAD', objectKey: string, payload?: Buffer): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalPath = config.s3.forcePathStyle
    ? `/${encodePath(config.s3.bucket)}${objectKey === '' ? '' : `/${encodePath(objectKey)}`}`
    : `/${encodePath(objectKey)}`;
  const body = payload ?? Buffer.alloc(0);
  const payloadHash = sha256(body);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = endpoint.host;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (method === 'PUT') headers['content-type'] = 'application/json';
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [method, canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), SERVICE), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`${endpoint.origin}${canonicalPath}`, {
    method,
    headers,
    body: method === 'PUT' ? body : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
}

export class StorageUnavailable extends Error {}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await s3Request('HEAD', '');
  if (head.status === 404) await s3Request('PUT', '');
  bucketReady = true;
}

/** Writes an object and resolves only once storage has confirmed it. */
export async function putObject(objectKey: string, body: Buffer): Promise<void> {
  try {
    await ensureBucket();
    const result = await s3Request('PUT', objectKey, body);
    if (result.status >= 300) throw new StorageUnavailable(`storage answered ${result.status}`);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw error;
    throw new StorageUnavailable(String(error));
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    const result = await s3Request('HEAD', '');
    return result.status < 500;
  } catch {
    return false;
  }
}
