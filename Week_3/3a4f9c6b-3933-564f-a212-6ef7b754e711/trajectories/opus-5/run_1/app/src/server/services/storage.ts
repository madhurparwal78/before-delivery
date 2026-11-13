import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const REQUEST_TIMEOUT_MS = 5000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
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

interface SignedRequest {
  url: string;
  method: 'GET' | 'PUT' | 'HEAD';
  headers: Record<string, string>;
  body?: Buffer;
}

function sign(
  method: SignedRequest['method'],
  objectPath: string,
  queryString: string,
  body: Buffer | undefined,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalUri = config.s3.forcePathStyle
    ? encodePath(`/${config.s3.bucket}${objectPath}`)
    : encodePath(objectPath);
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (body) headers['content-type'] = 'application/json';

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    method,
    canonicalUri,
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const base = config.s3.forcePathStyle
    ? `${endpoint.origin}/${config.s3.bucket}${objectPath}`
    : `${endpoint.protocol}//${host}${objectPath}`;

  return {
    url: queryString ? `${base}?${queryString}` : base,
    method,
    headers,
    ...(body ? { body } : {}),
  };
}

async function send(request: SignedRequest): Promise<Response> {
  return fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Thrown when object storage cannot be reached or refuses the call. */
export class StorageUnreachable extends Error {}

async function createBucket(): Promise<void> {
  const response = await send(sign('PUT', '/', '', Buffer.alloc(0)));
  if (!response.ok && response.status !== 409) {
    throw new StorageUnreachable(`Could not create bucket: ${response.status}`);
  }
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  let response: Response;
  try {
    response = await send(sign('PUT', `/${key}`, '', body));
  } catch (cause) {
    throw new StorageUnreachable(String(cause));
  }
  if (response.status === 404) {
    await createBucket();
    const retry = await send(sign('PUT', `/${key}`, '', body));
    if (!retry.ok) throw new StorageUnreachable(`PUT ${key} answered ${retry.status}`);
    return;
  }
  if (!response.ok) throw new StorageUnreachable(`PUT ${key} answered ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  let response: Response;
  try {
    response = await send(sign('GET', `/${key}`, '' , undefined));
  } catch (cause) {
    throw new StorageUnreachable(String(cause));
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnreachable(`GET ${key} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Probes the bucket, creating it when it does not exist yet. */
export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send(sign('GET', '/', 'list-type=2&max-keys=0', undefined));
    if (response.status === 404) {
      await createBucket();
      return true;
    }
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
