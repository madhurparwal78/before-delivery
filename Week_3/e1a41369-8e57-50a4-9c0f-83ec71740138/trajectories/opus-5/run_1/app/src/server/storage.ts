import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { fail } from './http/errors.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 4000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

interface S3Response {
  status: number;
  body: Buffer;
  contentType: string | null;
}

async function send(method: string, objectPath: string, body?: Buffer, contentType?: string): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const basePath = config.s3.forcePathStyle ? `/${config.s3.bucket}${objectPath}` : objectPath;
  const host = endpoint.host;
  const { stamp, date } = amzDate(new Date());
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (contentType) headers['content-type'] = contentType;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalUri = basePath
    .split('/')
    .map((segment) => (segment === '' ? '' : encodeSegment(segment)))
    .join('/');
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const requestHeaders: Record<string, string> = {
    ...headers,
    authorization: `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  };
  delete requestHeaders.host;

  const response = await fetch(`${endpoint.origin}${canonicalUri}`, {
    method,
    headers: requestHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : payload,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, body: buffer, contentType: response.headers.get('content-type') };
}

async function sendOrUnavailable(
  method: string,
  objectPath: string,
  body?: Buffer,
  contentType?: string,
): Promise<S3Response> {
  let response: S3Response;
  try {
    response = await send(method, objectPath, body, contentType);
  } catch {
    throw fail('storage_unavailable');
  }
  if (response.status >= 500) throw fail('storage_unavailable');
  return response;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await sendOrUnavailable('PUT', `/${key}`, body, contentType);
  if (response.status !== 200) throw fail('storage_unavailable');
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await sendOrUnavailable('GET', `/${key}`);
  if (response.status === 404) return null;
  if (response.status !== 200) throw fail('storage_unavailable');
  return response.body;
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '/');
  if (head.status === 404) await send('PUT', '/');
}

export async function storageReachable(): Promise<boolean> {
  try {
    const head = await send('HEAD', '/');
    return head.status < 500;
  } catch {
    return false;
  }
}

export function importObjectKey(userId: string, importId: string): string {
  return `imports/${userId}/${importId}.deedlist`;
}

export function bannerObjectKey(partyId: string, uploadId: string, contentType: string): string {
  return `banners/${partyId}/${uploadId}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
}
