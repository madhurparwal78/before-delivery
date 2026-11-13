import crypto from 'node:crypto';
import { config } from './config';

const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

function sha256hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(key: string | null): string {
  const segments = config.s3.forcePathStyle ? [config.s3.bucket] : [];
  if (key !== null) segments.push(...key.split('/'));
  return `/${segments.map(encodeSegment).join('/')}`;
}

function amzDate(at: Date): { stamp: string; date: string } {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

interface S3Result {
  status: number;
  headers: Headers;
  body: Buffer;
}

async function s3Request(
  method: string,
  key: string | null,
  body: Buffer | null,
  contentType?: string,
): Promise<S3Result> {
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = body === null ? EMPTY_SHA256 : sha256hex(payload);
  const { stamp, date } = amzDate(new Date());
  const path = canonicalPath(key);
  const endpoint = new URL(config.s3.endpoint);
  const host = endpoint.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (contentType !== undefined) headers['content-type'] = contentType;
  if (body !== null) headers['content-length'] = String(payload.byteLength);

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaderList = signedHeaders.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaderList, payloadHash].join('\n');

  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), 's3'), 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;
  delete headers.host;

  const response = await fetch(`${endpoint.origin}${path}`, {
    method,
    headers,
    body: body === null ? undefined : payload,
  });
  const responseBody = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body: responseBody };
}

export class StorageUnavailable extends Error {}

async function attempt(method: string, key: string | null, body: Buffer | null, contentType?: string): Promise<S3Result> {
  try {
    return await s3Request(method, key, body, contentType);
  } catch {
    throw new StorageUnavailable(`minio ${method} failed`);
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await attempt('HEAD', null, null);
  if (head.status === 200) return;
  if (head.status !== 404) throw new StorageUnavailable(`bucket check returned ${head.status}`);
  const made = await attempt('PUT', null, Buffer.alloc(0));
  if (made.status !== 200 && made.status !== 409) throw new StorageUnavailable(`bucket create returned ${made.status}`);
}

/** Stores bytes and confirms them from MinIO's own answer by re-reading the object's size. */
export async function putObjectConfirmed(key: string, body: Buffer, contentType: string): Promise<number> {
  const put = await attempt('PUT', key, body, contentType);
  if (put.status !== 200) throw new StorageUnavailable(`put returned ${put.status}`);
  const head = await attempt('HEAD', key, null);
  if (head.status !== 200) throw new StorageUnavailable(`head returned ${head.status}`);
  const size = Number(head.headers.get('content-length') ?? '-1');
  if (size !== body.byteLength) throw new StorageUnavailable(`stored ${size} bytes of ${body.byteLength}`);
  return size;
}

export async function getObject(key: string): Promise<Buffer> {
  const result = await attempt('GET', key, null);
  if (result.status !== 200) throw new StorageUnavailable(`get returned ${result.status}`);
  return result.body;
}

export async function storageReachable(): Promise<boolean> {
  try {
    const head = await attempt('HEAD', null, null);
    return head.status === 200 || head.status === 404;
  } catch {
    return false;
  }
}
