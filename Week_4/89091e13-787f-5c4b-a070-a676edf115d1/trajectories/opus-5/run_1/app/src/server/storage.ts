import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const REQUEST_TIMEOUT_MS = 3000;

function sha256Hex(body: Uint8Array | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
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

interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

/** AWS Signature Version 4 for the S3 REST API, as MinIO expects it. */
function sign(method: string, path: string, query: string, body: Uint8Array | null): SignedRequest {
  const { stamp, date } = amzDate(new Date());
  const endpoint = new URL(config.s3.endpoint);
  const host = endpoint.host;
  const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    encodePath(path),
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  const url = `${endpoint.origin}${encodePath(path)}${query ? `?${query}` : ''}`;
  return body ? { url, method, headers, body } : { url, method, headers };
}

async function send(
  method: string,
  path: string,
  query: string,
  body: Uint8Array | null,
): Promise<{ status: number; body: Uint8Array }> {
  const request = sign(method, path, query, body);
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body ? Buffer.from(request.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, body: bytes };
}

export class StorageUnavailable extends Error {}

async function call(
  method: string,
  path: string,
  query: string,
  body: Uint8Array | null,
): Promise<{ status: number; body: Uint8Array }> {
  try {
    return await send(method, path, query, body);
  } catch {
    throw new StorageUnavailable('storage unreachable');
  }
}

function bucketPath(key?: string): string {
  return key === undefined ? `/${config.s3.bucket}` : `/${config.s3.bucket}/${key}`;
}

/** Checks reachability and creates the bucket when it is missing. */
export async function probeStorage(): Promise<boolean> {
  try {
    const head = await call('HEAD', bucketPath(), '', null);
    if (head.status === 404) await call('PUT', bucketPath(), '', new Uint8Array());
    return true;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Uint8Array): Promise<void> {
  const result = await call('PUT', bucketPath(key), '', body);
  if (result.status === 404) {
    await call('PUT', bucketPath(), '', new Uint8Array());
    await call('PUT', bucketPath(key), '', body);
    return;
  }
  if (result.status >= 300) throw new StorageUnavailable(`put failed with ${result.status}`);
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  const result = await call('GET', bucketPath(key), '', null);
  if (result.status === 404) return null;
  if (result.status >= 300) throw new StorageUnavailable(`get failed with ${result.status}`);
  return result.body;
}

export async function emptyBucket(): Promise<void> {
  let token: string | null = null;
  do {
    const query = token
      ? `continuation-token=${encodeURIComponent(token)}&list-type=2`
      : 'list-type=2';
    const result = await call('GET', bucketPath(), query, null);
    if (result.status === 404) return;
    const xml = Buffer.from(result.body).toString('utf8');
    const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => decodeXml(match[1]));
    for (const key of keys) await call('DELETE', bucketPath(key), '', null);
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    token = next ? decodeXml(next[1]) : null;
  } while (token);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function blobObjectKey(blobId: string): string {
  return `blobs/${blobId}`;
}

export function squareObjectKey(workspaceId: string, height: number): string {
  return `squares/${workspaceId}/${height}.bin`;
}
