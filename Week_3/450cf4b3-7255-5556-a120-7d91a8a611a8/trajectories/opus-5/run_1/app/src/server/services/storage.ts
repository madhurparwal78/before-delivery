import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

export class StorageUnavailableError extends Error {
  constructor() {
    super('storage unavailable');
    this.name = 'StorageUnavailableError';
  }
}

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(method: string, key: string, payload: Buffer | null): SignedRequest {
  const endpoint = new URL(config.storage.endpoint);
  const keyPath = key.split('/').map(encodeSegment).join('/');
  const canonicalUri = config.storage.forcePathStyle
    ? `/${encodeSegment(config.storage.bucket)}/${keyPath}`
    : `/${keyPath}`;
  const host = config.storage.forcePathStyle
    ? endpoint.host
    : `${config.storage.bucket}.${endpoint.host}`;

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = payload === null ? EMPTY_SHA256 : sha256Hex(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (payload !== null) {
    headers['content-length'] = String(payload.length);
  }

  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = headerNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${config.storage.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.storage.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.storage.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `${endpoint.origin}${canonicalUri}`,
    headers,
  };
}

/** Stores the uploaded bytes exactly as submitted under its own key. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const signed = signRequest('PUT', key, body);
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method: 'PUT',
      headers: { ...signed.headers, 'content-type': contentType },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StorageUnavailableError();
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnavailableError();
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const signed = signRequest('GET', key, null);
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method: 'GET',
      headers: signed.headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StorageUnavailableError();
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnavailableError();
  }
  return Buffer.from(await response.arrayBuffer());
}
