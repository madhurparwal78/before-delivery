import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageUnavailableError extends Error {
  constructor() {
    super('Object storage is unreachable');
    this.name = 'StorageUnavailableError';
  }
}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 5000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replaceAll('!', '%21').replaceAll('*', '%2A').replaceAll("'", '%27').replaceAll('(', '%28').replaceAll(')', '%29');
}

interface Target {
  readonly host: string;
  readonly origin: string;
  readonly uri: string;
}

/** An empty key addresses the bucket itself. */
function target(key: string): Target {
  const endpoint = new URL(config.s3.endpoint);
  const path = key === '' ? '' : `/${key.split('/').map(encodeSegment).join('/')}`;
  if (config.s3.forcePathStyle) {
    return { host: endpoint.host, origin: endpoint.origin, uri: `/${config.s3.bucket}${path}` };
  }
  const host = `${config.s3.bucket}.${endpoint.host}`;
  return { host, origin: `${endpoint.protocol}//${host}`, uri: path === '' ? '/' : path };
}

function amzDate(now: Date): { long: string; short: string } {
  const long = now.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}/, '');
  return { long, short: long.slice(0, 8) };
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function sign(method: string, key: string, payload: Buffer, contentType: string | null): SignedRequest {
  const { host, origin, uri } = target(key);
  const { long, short } = amzDate(new Date());
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': long,
  };
  if (contentType !== null) headers['content-type'] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${short}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, long, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, short);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    url: `${origin}${uri}`,
    headers: {
      ...headers,
      authorization: `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function send(
  method: 'GET' | 'PUT' | 'HEAD',
  key: string,
  payload: Buffer,
  contentType: string | null,
): Promise<Response> {
  const signed = sign(method, key, payload, contentType);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' ? new Uint8Array(payload) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailableError();
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', key, body, contentType);
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StorageUnavailableError();
  }
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send('GET', key, Buffer.alloc(0), null);
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StorageUnavailableError();
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function ensureBucket(): Promise<void> {
  try {
    const response = await send('PUT', '', Buffer.alloc(0), null);
    await response.arrayBuffer();
  } catch {
    // The bucket is created again on the next write once storage comes back.
  }
}
