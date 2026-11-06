import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('Object storage is unreachable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

const UNSIGNED_CHARACTERS = /[^A-Za-z0-9\-._~]/g;

function encodePath(key: string): string {
  return key
    .split('/')
    .map((segment) =>
      segment.replace(UNSIGNED_CHARACTERS, (character) =>
        [...Buffer.from(character, 'utf8')]
          .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
          .join(''),
      ),
    )
    .join('/');
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function sign(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const pathPrefix = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '';
  const canonicalUri = `${pathPrefix}${key === '' ? '/' : `/${encodePath(key)}`}`;
  const url = new URL(canonicalUri, endpoint);
  if (!config.s3.forcePathStyle) {
    url.hostname = `${config.s3.bucket}.${endpoint.hostname}`;
  }

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    ...extraHeaders,
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const lowerHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()]),
  );
  const sortedNames = [...lowerHeaders.keys()].sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${lowerHeaders.get(name) ?? ''}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: url.toString(), headers };
}

async function send(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const signed = sign(method, key, payload, extraHeaders);
  const carriesBody = method === 'PUT' || method === 'POST';
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: carriesBody ? payload : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

export async function bucketAnswers(): Promise<boolean> {
  try {
    const response = await send('HEAD', '', Buffer.alloc(0), {}, 2000);
    return response.ok;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send(
    'PUT',
    key,
    body,
    { 'content-type': contentType, 'content-length': String(body.length) },
    30_000,
  );
  if (!response.ok) {
    await response.text();
    throw new StorageUnavailable(new Error(`PUT answered ${response.status}`));
  }
}

export interface StoredObject {
  readonly body: Buffer;
  readonly contentType: string;
}

export async function getObject(key: string): Promise<StoredObject> {
  const response = await send('GET', key, Buffer.alloc(0), {}, 30_000);
  if (!response.ok) {
    await response.text();
    throw new StorageUnavailable(new Error(`GET answered ${response.status}`));
  }
  const body = Buffer.from(await response.arrayBuffer());
  return {
    body,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key, Buffer.alloc(0), {}, 10_000);
  if (!response.ok && response.status !== 404) {
    await response.text();
    throw new StorageUnavailable(new Error(`DELETE answered ${response.status}`));
  }
}
