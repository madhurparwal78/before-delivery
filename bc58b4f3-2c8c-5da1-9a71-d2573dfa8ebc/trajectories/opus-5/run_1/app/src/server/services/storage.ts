import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageUnavailable extends Error {
  constructor(cause: unknown) {
    super('Object storage is unavailable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

const REQUEST_TIMEOUT_MS = 5000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; day: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  return { stamp, day: stamp.slice(0, 8) };
}

function signedHeadersFor(
  method: string,
  url: URL,
  payloadHash: string,
  extra: Record<string, string>,
): Record<string, string> {
  const { stamp, day } = amzDate(new Date());
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extra,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${(headers[name] ?? '').trim()}\n`).join('');
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${config.storage.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = hmac(`AWS4${config.storage.secretAccessKey}`, day);
  const regionKey = hmac(dateKey, config.storage.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, ` +
    `SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return headers;
}

function bucketBase(): string {
  const base = config.storage.endpoint.replace(/\/$/, '');
  return config.storage.forcePathStyle
    ? `${base}/${config.storage.bucket}`
    : base.replace('://', `://${config.storage.bucket}.`);
}

function objectUrl(key: string): URL {
  return new URL(`${bucketBase()}/${key}`);
}

async function send(
  method: string,
  url: URL,
  body: Buffer | undefined,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const payloadHash = sha256Hex(body ?? '');
  const headers = signedHeadersFor(method, url, payloadHash, extraHeaders);
  try {
    return await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: new Uint8Array(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

export async function ensureBucket(): Promise<void> {
  const url = new URL(bucketBase());
  const head = await send('HEAD', url, undefined);
  if (head.status === 404) {
    await send('PUT', url, Buffer.alloc(0));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', objectUrl(key), body, { 'content-type': contentType });
  if (!response.ok) {
    throw new StorageUnavailable(new Error(`PUT ${key} answered ${response.status}`));
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send('GET', objectUrl(key), undefined);
  if (!response.ok) {
    throw new StorageUnavailable(new Error(`GET ${key} answered ${response.status}`));
  }
  return Buffer.from(await response.arrayBuffer());
}
