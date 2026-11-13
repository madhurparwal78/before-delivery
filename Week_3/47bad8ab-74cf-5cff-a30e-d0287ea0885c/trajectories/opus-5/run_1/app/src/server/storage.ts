import { createHash, createHmac } from 'node:crypto';
import { config } from './config';
import { errors } from './errors';

const SERVICE = 's3';

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(
  method: string,
  path: string,
  body: Uint8Array,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalUri = encodePath(path);
  const url = `${endpoint.origin}${canonicalUri}`;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const sortedKeys = Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort();
  const canonicalHeaders = sortedKeys
    .map((key) => `${key}:${String(headers[key] ?? headers[key.toLowerCase()]).trim()}\n`)
    .join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, headers };
}

function objectPath(key: string): string {
  return config.s3.forcePathStyle ? `/${config.s3.bucket}/${key}` : `/${key}`;
}

async function send(
  method: string,
  path: string,
  body: Uint8Array,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 10000,
): Promise<Response> {
  const signed = sign(method, path, body, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : (body as unknown as BodyInit),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw errors.storageUnavailable();
  }
}

async function createBucket(): Promise<void> {
  const response = await send('PUT', `/${config.s3.bucket}`, new Uint8Array());
  if (!response.ok && response.status !== 409) throw errors.storageUnavailable();
  await response.arrayBuffer();
}

export const storage = {
  async ensureBucket(): Promise<void> {
    const response = await send('HEAD', `/${config.s3.bucket}`, new Uint8Array());
    await response.arrayBuffer();
    if (response.status === 404) await createBucket();
    else if (!response.ok) throw errors.storageUnavailable();
  },

  /** True while object storage answers; used by the health route with a one-second budget. */
  async reachable(): Promise<boolean> {
    try {
      const response = await send('HEAD', `/${config.s3.bucket}`, new Uint8Array(), {}, 1000);
      await response.arrayBuffer();
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  },

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const headers = { 'content-type': contentType };
    let response = await send('PUT', objectPath(key), body, headers);
    if (response.status === 404) {
      await response.arrayBuffer();
      await createBucket();
      response = await send('PUT', objectPath(key), body, headers);
    }
    await response.arrayBuffer();
    if (!response.ok) throw errors.storageUnavailable();
  },

  async get(key: string): Promise<Uint8Array | null> {
    const response = await send('GET', objectPath(key), new Uint8Array());
    if (response.status === 404) {
      await response.arrayBuffer();
      return null;
    }
    if (!response.ok) {
      await response.arrayBuffer();
      throw errors.storageUnavailable();
    }
    return new Uint8Array(await response.arrayBuffer());
  },
};

export function sha256Of(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

export const uploadKey = (puzzleId: string): string => `uploads/${puzzleId}/original.overlap.txt`;
export const recordKey = (gameId: string): string => `records/${gameId}.json`;
