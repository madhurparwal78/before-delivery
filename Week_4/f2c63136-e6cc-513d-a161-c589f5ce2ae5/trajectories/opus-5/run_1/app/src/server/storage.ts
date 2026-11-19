import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

export const PUSH_OUTAGE_MESSAGE = 'Storage is unavailable. Nothing was saved. Try again in a moment.';
export const ARCHIVE_OUTAGE_MESSAGE = 'Storage is unavailable. The archive was not exported. Try again in a moment.';

export class StorageUnavailable extends Error {
  constructor() {
    super(PUSH_OUTAGE_MESSAGE);
  }
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(date: Date): { stamp: string; dateOnly: string } {
  const stamp = `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, dateOnly: stamp.slice(0, 8) };
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

async function s3Request(method: string, key: string, body?: Buffer): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${key ? `/${encodePath(key)}` : ''}`
    : `${key ? `/${encodePath(key)}` : '/'}`;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const { stamp, dateOnly } = amzDate(new Date());

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (body) headers['content-length'] = String(payload.length);

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, objectPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateOnly}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateOnly), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpoint.origin}${objectPath}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body ? new Uint8Array(payload) : undefined,
    signal: AbortSignal.timeout(4000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, body: buffer };
}

async function ensureBucket(): Promise<void> {
  const head = await s3Request('HEAD', '');
  if (head.status === 404) {
    await s3Request('PUT', '');
  }
}

let bucketChecked = false;

export async function putObject(key: string, body: Buffer): Promise<void> {
  try {
    if (!bucketChecked) {
      await ensureBucket();
      bucketChecked = true;
    }
    const response = await s3Request('PUT', key, body);
    if (response.status >= 300) throw new Error(`storage put failed with ${response.status}`);
  } catch {
    throw new StorageUnavailable();
  }
}

export async function getObject(key: string): Promise<Buffer> {
  let response: S3Response;
  try {
    response = await s3Request('GET', key);
  } catch {
    throw new StorageUnavailable();
  }
  if (response.status !== 200) throw new StorageUnavailable();
  return response.body;
}

let storageOk = true;

export function lastStorageOk(): boolean {
  return storageOk;
}

export function startStorageProbe(): void {
  const probe = async () => {
    storageOk = await storageReachable();
  };
  void probe();
  setInterval(() => {
    void probe();
  }, 2000).unref();
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await s3Request('HEAD', '');
    return response.status < 500;
  } catch {
    return false;
  }
}
