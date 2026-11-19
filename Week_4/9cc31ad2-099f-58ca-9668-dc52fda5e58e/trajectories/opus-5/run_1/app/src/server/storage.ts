import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface S3RequestOptions {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: Buffer;
  extraHeaders?: Record<string, string>;
  timeoutMs: number;
}

async function s3Request(options: S3RequestOptions): Promise<Response> {
  const { endpoint, region, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const canonicalUri = encodePath(options.path);
  const query = options.query ?? {};
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key]!)}`)
    .join('&');
  const payloadHash = options.body ? sha256Hex(options.body) : EMPTY_SHA256;
  const { stamp, date } = amzDate(new Date());
  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...(options.extraHeaders ?? {}),
  };
  const headerNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = headerNames
    .map((name) => `${name}:${headers[name]!.trim()}\n`)
    .join('');
  const signedHeaders = headerNames.join(';');
  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const target = new URL(`${base.origin}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`);
  return await fetch(target, {
    method: options.method,
    headers,
    body: options.body ?? null,
    signal: AbortSignal.timeout(options.timeoutMs),
  });
}

function objectPath(key: string): string {
  return config.s3.forcePathStyle ? `/${config.s3.bucket}/${key}` : `/${key}`;
}

export class ReplayStorageUnavailable extends Error {}

export async function putReplay(
  key: string,
  bytes: Buffer,
  sha256: string,
  timeoutMs = 5000,
): Promise<void> {
  let response: Response;
  try {
    response = await s3Request({
      method: 'PUT',
      path: objectPath(key),
      body: bytes,
      extraHeaders: { 'content-type': 'application/json', 'x-amz-meta-sha256': sha256 },
      timeoutMs,
    });
  } catch (error) {
    throw new ReplayStorageUnavailable((error as Error).message);
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw new ReplayStorageUnavailable(`storage answered ${response.status}`);
  }
  await response.arrayBuffer();
}

export async function getReplay(key: string): Promise<Buffer | null> {
  let response: Response;
  try {
    response = await s3Request({ method: 'GET', path: objectPath(key), timeoutMs: 5000 });
  } catch (error) {
    throw new ReplayStorageUnavailable((error as Error).message);
  }
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw new ReplayStorageUnavailable(`storage answered ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function replayStorageAvailable(): Promise<boolean> {
  try {
    const response = await s3Request({
      method: 'GET',
      path: config.s3.forcePathStyle ? `/${config.s3.bucket}` : '/',
      query: { 'max-keys': '0', 'list-type': '2' },
      timeoutMs: 2000,
    });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
