/**
 * MinIO object storage over S3 with Signature Version 4. Objects live at
 * uploads/<upload id>/<chunk number>, media/<sha256> and manifests/<export id>.json.
 */
import { createHash, createHmac } from 'node:crypto';
import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { config } from '../config.js';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const UNSIGNED = 'UNSIGNED-PAYLOAD';

function stamp(now: Date): { date: string; dateTime: string } {
  const dateTime = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { date: dateTime.slice(0, 8), dateTime };
}

function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('/');
}

function signingKey(date: string): Buffer {
  const dateKey = createHmac('sha256', `AWS4${config.s3.secretAccessKey}`).update(date).digest();
  const regionKey = createHmac('sha256', dateKey).update(config.s3.region).digest();
  const serviceKey = createHmac('sha256', regionKey).update('s3').digest();
  return createHmac('sha256', serviceKey).update('aws4_request').digest();
}

interface SignedRequest {
  url: URL;
  headers: Record<string, string>;
}

function bucketUrl(key: string): URL {
  const url = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) {
    url.pathname = key === '' ? `/${config.s3.bucket}` : `/${config.s3.bucket}/${encodePath(key)}`;
  } else {
    url.host = `${config.s3.bucket}.${url.host}`;
    url.pathname = key === '' ? '/' : `/${encodePath(key)}`;
  }
  return url;
}

function signRequest(method: string, url: URL, payloadHash: string, extraHeaders: Record<string, string>): SignedRequest {
  const { date, dateTime } = stamp(new Date());
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateTime,
    ...extraHeaders,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');
  const canonicalRequest = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, names.join(';'), payloadHash].join(
    '\n',
  );
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', dateTime, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signature = createHmac('sha256', signingKey(date)).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(
    ';',
  )}, Signature=${signature}`;
  return { url, headers };
}

interface StorageResponse {
  status: number;
  body: Buffer;
}

function send(method: string, signed: SignedRequest, body?: Buffer): Promise<StorageResponse> {
  const sender = signed.url.protocol === 'https:' ? httpsRequest : request;
  return new Promise((resolve, reject) => {
    const outgoing = sender(
      {
        protocol: signed.url.protocol,
        hostname: signed.url.hostname,
        port: signed.url.port,
        path: `${signed.url.pathname}${signed.url.search}`,
        method,
        headers: { ...signed.headers, 'content-length': body ? body.length : 0 },
        timeout: 8000,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks) }));
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error('storage timeout')));
    outgoing.on('error', reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

export class StorageDown extends Error {
  constructor(cause?: unknown) {
    super('storage unreachable');
    this.name = 'StorageDown';
    this.cause = cause;
  }
}

let storageUp = true;

export function storageIsUp(): boolean {
  return storageUp;
}

async function run(method: string, key: string, body?: Buffer, extra: Record<string, string> = {}): Promise<StorageResponse> {
  const payloadHash = body ? createHash('sha256').update(body).digest('hex') : EMPTY_SHA256;
  let response: StorageResponse;
  try {
    response = await send(method, signRequest(method, bucketUrl(key), payloadHash, extra), body);
  } catch (error) {
    storageUp = false;
    throw new StorageDown(error);
  }
  if (response.status >= 500) {
    storageUp = false;
    throw new StorageDown(response.body.toString('utf8'));
  }
  storageUp = true;
  return response;
}

export async function putObject(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
  const response = await run('PUT', key, body, { 'content-type': contentType });
  if (response.status >= 300) throw new Error(`storage put failed: ${response.status} ${response.body.toString('utf8')}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await run('GET', key);
  if (response.status === 404) return null;
  if (response.status >= 300) throw new Error(`storage get failed: ${response.status}`);
  return response.body;
}

export async function headObject(key: string): Promise<boolean> {
  const response = await run('HEAD', key);
  return response.status < 300;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await run('DELETE', key);
  if (response.status >= 300 && response.status !== 404) throw new Error(`storage delete failed: ${response.status}`);
}

/** A presigned GET link that expires after MANIFEST_LINK_SECONDS. */
export function presignGet(key: string, seconds: number): string {
  const url = bucketUrl(key);
  const { date, dateTime } = stamp(new Date());
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${config.s3.accessKeyId}/${scope}`);
  url.searchParams.set('X-Amz-Date', dateTime);
  url.searchParams.set('X-Amz-Expires', String(seconds));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  const canonicalRequest = ['GET', url.pathname, url.searchParams.toString(), `host:${url.host}\n`, 'host', UNSIGNED].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', dateTime, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signature = createHmac('sha256', signingKey(date)).update(toSign).digest('hex');
  url.searchParams.set('X-Amz-Signature', signature);
  return url.toString();
}

export async function ensureBucket(): Promise<void> {
  const response = await run('PUT', '');
  if (response.status >= 300 && response.status !== 409) {
    const text = response.body.toString('utf8');
    if (!text.includes('BucketAlreadyOwnedByYou') && !text.includes('BucketAlreadyExists')) {
      throw new Error(`cannot create bucket: ${response.status} ${text}`);
    }
  }
}

export async function probeStorage(): Promise<boolean> {
  try {
    await headObject('media/.probe');
    return true;
  } catch {
    return false;
  }
}

export const StorageKeys = {
  chunk: (uploadId: string, n: number): string => `uploads/${uploadId}/${n}`,
  media: (sha256: string): string => `media/${sha256}`,
  manifest: (exportId: string): string => `manifests/${exportId}.json`,
};
