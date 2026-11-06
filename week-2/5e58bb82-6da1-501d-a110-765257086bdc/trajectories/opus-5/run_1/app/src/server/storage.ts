import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

/**
 * A minimal S3 client. It speaks SigV4 directly so that no SDK error name,
 * endpoint or bucket name can escape into a response: every failure here becomes
 * a plain StorageUnreachable.
 */
export class StorageUnreachable extends Error {
  constructor() {
    super('storage unreachable');
  }
}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 3000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { long: string; short: string } {
  const long = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { long, short: long.slice(0, 8) };
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) =>
      `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    ))
    .join('/');
}

interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

function signRequest(
  method: string,
  pathname: string,
  query: string,
  extraHeaders: Record<string, string>,
  payload: Buffer | 'UNSIGNED' | null,
): SignedRequest {
  const base = new URL(config.s3.endpoint);
  const now = new Date();
  const { long, short } = amzDate(now);
  const payloadHash =
    payload === null ? sha256Hex('') : payload === 'UNSIGNED' ? 'UNSIGNED-PAYLOAD' : sha256Hex(payload);

  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': long,
    ...extraHeaders,
  };

  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lookup = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${String(lookup.get(name)).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    method,
    pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${short}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, long, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, short);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization = `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const request: SignedRequest = {
    url: `${base.origin}${pathname}${query ? `?${query}` : ''}`,
    method,
    headers,
  };
  if (payload !== null && payload !== 'UNSIGNED') request.body = payload;
  return request;
}

function objectPath(key: string): string {
  return config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${encodeKeyPath(key)}`
    : `/${encodeKeyPath(key)}`;
}

async function send(request: SignedRequest, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
  } catch {
    throw new StorageUnreachable();
  } finally {
    clearTimeout(timer);
  }
}

/** True when the provisioned bucket answers. */
export async function probeStorage(): Promise<boolean> {
  try {
    const path = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '/';
    const response = await send(signRequest('HEAD', path, '', {}, null), 2500);
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

/**
 * Writes the exact bytes with object storage's own SHA-256 checksum, so storage
 * verifies them itself and the stored object reports the declared checksum.
 */
export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
  sha256Hex256: string,
): Promise<void> {
  const checksum = Buffer.from(sha256Hex256, 'hex').toString('base64');
  const response = await send(
    signRequest(
      'PUT',
      objectPath(key),
      '',
      {
        'content-type': contentType,
        'content-length': String(bytes.byteLength),
        'x-amz-checksum-sha256': checksum,
      },
      bytes,
    ),
    20_000,
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new StorageUnreachable();
  }
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
  const response = await send(signRequest('GET', objectPath(key), '', {}, null), 20_000);
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new StorageUnreachable();
  }
  const size = Number(response.headers.get('content-length') ?? '0');
  return { body: response.body, size };
}

export async function getObjectBytes(key: string): Promise<Buffer | null> {
  const object = await getObject(key);
  if (!object) return null;
  const chunks: Uint8Array[] = [];
  const reader = object.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export function lineFileKey(missionId: string, lineId: string, fileName: string): string {
  return `lines/${missionId}/${lineId}/${fileName}`;
}

export function reportKey(missionId: string): string {
  return `reports/${missionId}/coverage-report.json`;
}
