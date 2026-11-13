import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { storageUnavailable } from './http/errors.js';

const SERVICE = 's3';
const TIMEOUT_MS = 8000;

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

interface S3Response {
  status: number;
  body: Buffer;
  headers: Headers;
}

async function send(
  method: string,
  objectPath: string,
  options: { body?: Buffer; query?: Record<string, string>; contentType?: string } = {},
): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const basePath = config.s3.forcePathStyle ? `/${config.s3.bucket}${objectPath}` : objectPath;
  const canonicalUri = encodePath(basePath);
  const queryEntries = Object.entries(options.query ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const canonicalQuery = queryEntries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const body = options.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const { stamp, date } = amzDate(new Date());
  const host = endpoint.host;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = `${Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}`)
    .join('\n')}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `${endpoint.origin}${canonicalUri}${canonicalQuery === '' ? '' : `?${canonicalQuery}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...headers, authorization },
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw storageUnavailable();
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (response.status >= 500) throw storageUnavailable();
  return { status: response.status, body: buffer, headers: response.headers };
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '/');
  if (head.status === 200 || head.status === 403) return;
  await send('PUT', '/');
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const response = await send('PUT', `/${key}`, { body: bytes, contentType });
  if (response.status < 200 || response.status >= 300) throw storageUnavailable();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', `/${key}`);
  if (response.status === 404) return null;
  if (response.status !== 200) throw storageUnavailable();
  return response.body;
}

/** Confirms a stored object is really in the bucket. */
export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', `/${key}`);
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw storageUnavailable();
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', `/${key}`);
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
    throw storageUnavailable();
  }
}

export async function listObjects(prefix: string): Promise<string[]> {
  const response = await send('GET', '/', { query: { 'list-type': '2', prefix } });
  if (response.status !== 200) throw storageUnavailable();
  const text = response.body.toString('utf8');
  return [...text.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => match[1] ?? '');
}
