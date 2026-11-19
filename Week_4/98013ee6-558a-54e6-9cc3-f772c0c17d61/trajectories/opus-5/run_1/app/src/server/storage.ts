import { createHash, createHmac } from 'node:crypto';
import { request } from 'node:http';
import { request as requestSecure } from 'node:https';
import { env } from './env.js';

const SERVICE = 's3';
const endpoint = new URL(env.s3.endpoint);
const secure = endpoint.protocol === 'https:';

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function amzDate(date: Date): { stamp: string; short: string } {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, short: stamp.slice(0, 8) };
}

function signingKey(short: string): Buffer {
  const dateKey = hmac(`AWS4${env.s3.secretAccessKey}`, short);
  const regionKey = hmac(dateKey, env.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function objectPath(key: string): string {
  const encoded = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return env.s3.forcePathStyle ? `/${env.s3.bucket}/${encoded}` : `/${encoded}`;
}

function hostHeader(): string {
  const port = endpoint.port;
  const host = env.s3.forcePathStyle ? endpoint.hostname : `${env.s3.bucket}.${endpoint.hostname}`;
  return port ? `${host}:${port}` : host;
}

interface SignedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: Buffer;
}

function sign(method: string, path: string, body: Buffer | null, extra: Record<string, string> = {}): SignedRequest {
  const date = amzDate(new Date());
  const payloadHash = hash(body ?? '');
  const headers: Record<string, string> = {
    host: hostHeader(),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': date.stamp,
    ...extra,
  };
  const signedHeaders = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${String(headers[name]).trim()}\n`)
    .join('');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date.short}/${env.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date.stamp, scope, hash(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(date.short), stringToSign).toString('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
  return { method, path, headers, body: body ?? undefined };
}

interface StorageResponse {
  status: number;
  body: Buffer;
  contentType: string | null;
}

function send(signed: SignedRequest, timeoutMs = 5000): Promise<StorageResponse> {
  return new Promise((resolve, reject) => {
    const driver = secure ? requestSecure : request;
    const clientRequest = driver(
      {
        host: endpoint.hostname,
        port: endpoint.port ? Number(endpoint.port) : secure ? 443 : 80,
        method: signed.method,
        path: signed.path,
        headers: {
          ...signed.headers,
          'content-length': String(signed.body?.length ?? 0),
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
            contentType: response.headers['content-type'] ?? null,
          }),
        );
        response.on('error', reject);
      },
    );
    clientRequest.on('timeout', () => clientRequest.destroy(new Error('storage timeout')));
    clientRequest.on('error', reject);
    if (signed.body) clientRequest.write(signed.body);
    clientRequest.end();
  });
}

export class StorageError extends Error {}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const signed = sign('PUT', objectPath(key), body, { 'content-type': contentType });
  let response: StorageResponse;
  try {
    response = await send(signed, 15000);
  } catch (error) {
    throw new StorageError(`put failed: ${String(error)}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new StorageError(`put failed with status ${response.status}`);
  }
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string | null } | null> {
  const signed = sign('GET', objectPath(key), null);
  let response: StorageResponse;
  try {
    response = await send(signed, 10000);
  } catch (error) {
    throw new StorageError(`get failed: ${String(error)}`);
  }
  if (response.status === 404) return null;
  if (response.status < 200 || response.status >= 300) {
    throw new StorageError(`get failed with status ${response.status}`);
  }
  return { body: response.body, contentType: response.contentType };
}

export async function headObject(key: string): Promise<boolean> {
  const signed = sign('HEAD', objectPath(key), null);
  let response: StorageResponse;
  try {
    response = await send(signed, 10000);
  } catch (error) {
    throw new StorageError(`head failed: ${String(error)}`);
  }
  if (response.status === 404) return false;
  if (response.status < 200 || response.status >= 300) {
    throw new StorageError(`head failed with status ${response.status}`);
  }
  return true;
}

export async function deleteObject(key: string): Promise<void> {
  const signed = sign('DELETE', objectPath(key), null);
  try {
    await send(signed, 10000);
  } catch {
    // The object stays until a later sweep; storage is unreachable right now.
  }
}

async function probe(): Promise<boolean> {
  const path = env.s3.forcePathStyle ? `/${env.s3.bucket}` : '/';
  const signed = sign('HEAD', path, null);
  try {
    const response = await send(signed, 3000);
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

let storageOk = true;

export function storageHealthy(): boolean {
  return storageOk;
}

export function markStorageDown(): void {
  storageOk = false;
}

export async function checkStorage(): Promise<boolean> {
  storageOk = await probe();
  return storageOk;
}

export async function ensureBucket(): Promise<void> {
  const path = env.s3.forcePathStyle ? `/${env.s3.bucket}` : '/';
  try {
    const head = await send(sign('HEAD', path, null), 3000);
    if (head.status === 404) {
      await send(sign('PUT', path, Buffer.alloc(0)), 5000);
    }
  } catch {
    markStorageDown();
  }
}

export function startStorageChecks(): void {
  void checkStorage();
  setInterval(() => {
    void checkStorage();
  }, 4000).unref();
}
