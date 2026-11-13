import { createHash, createHmac } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { config } from './config.js';

/** Object storage cannot be reached or refused the exchange's credentials. */
export class StorageUnavailable extends Error {}

const REQUEST_TIMEOUT_MS = 5000;
const endpoint = new URL(config.s3.endpoint);
let bucketReady = false;

const hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string | null): { host: string; path: string } {
  const segments = key === null ? [] : key.split('/').map(encodeSegment);
  if (config.s3.pathStyle) return { host: endpoint.host, path: `/${[encodeSegment(config.s3.bucket), ...segments].join('/')}` };
  return { host: `${config.s3.bucket}.${endpoint.host}`, path: `/${segments.join('/')}` };
}

function signedHeaders(method: string, host: string, path: string, payload: Buffer): Record<string, string> {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = stamp.slice(0, 8);
  const payloadHash = hex(payload);
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonical = [method, path, '', canonicalHeaders, names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, hex(canonical)].join('\n');
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return headers;
}

function call(method: string, key: string | null, body: Buffer = Buffer.alloc(0)): Promise<IncomingMessage> {
  const { host, path } = target(key);
  const headers = signedHeaders(method, host, path, body);
  const client = endpoint.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        hostname: host.replace(/:\d+$/, ''),
        port: endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80),
        method,
        path,
        headers: { ...headers, 'content-length': String(body.length) },
        timeout: REQUEST_TIMEOUT_MS,
      },
      resolve,
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => reject(new StorageUnavailable()));
    request.end(body);
  });
}

async function status(method: string, key: string | null, body?: Buffer): Promise<{ code: number; headers: IncomingMessage['headers'] }> {
  const response = await call(method, key, body);
  response.resume();
  await new Promise((resolve) => response.on('end', resolve).on('error', resolve).on('close', resolve));
  return { code: response.statusCode ?? 0, headers: response.headers };
}

const createBody = (): Buffer | undefined =>
  config.s3.region === 'us-east-1'
    ? undefined
    : Buffer.from(
        `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${config.s3.region}</LocationConstraint></CreateBucketConfiguration>`,
      );

/** Creates the private bucket when it is missing. Throws StorageUnavailable when storage cannot be reached. */
export async function ensureBucket(): Promise<void> {
  const head = await status('HEAD', null);
  if (head.code === 200) {
    bucketReady = true;
    return;
  }
  if (head.code !== 404) throw new StorageUnavailable();
  const made = await status('PUT', null, createBody());
  if (made.code !== 200 && made.code !== 409) throw new StorageUnavailable();
  bucketReady = true;
}

export async function reachable(): Promise<boolean> {
  try {
    await ensureBucket();
    return true;
  } catch {
    return false;
  }
}

async function ready(): Promise<void> {
  if (!bucketReady) await ensureBucket();
}

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  await ready();
  if ((await status('PUT', key, bytes)).code !== 200) throw new StorageUnavailable();
}

/** The stored object's size, or null when the object does not exist. */
export async function objectSize(key: string): Promise<number | null> {
  await ready();
  const head = await status('HEAD', key);
  if (head.code === 404) return null;
  if (head.code !== 200) throw new StorageUnavailable();
  return Number(head.headers['content-length']);
}

/** The object's byte stream, or null when it does not exist. */
export async function getObject(key: string): Promise<IncomingMessage | null> {
  await ready();
  const response = await call('GET', key);
  if (response.statusCode === 200) return response;
  response.resume();
  if (response.statusCode === 404) return null;
  throw new StorageUnavailable();
}

export async function removeObject(key: string): Promise<void> {
  await ready();
  const result = await status('DELETE', key);
  if (result.code !== 204 && result.code !== 200 && result.code !== 404) throw new StorageUnavailable();
}

export const objectKey = (ownerId: string, blobId: string): string => `blobs/${ownerId}/${blobId}`;
