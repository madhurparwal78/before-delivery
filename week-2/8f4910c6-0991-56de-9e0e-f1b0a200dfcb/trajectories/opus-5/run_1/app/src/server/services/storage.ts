import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { storageUnavailable } from '../http/errors.js';

const TIMEOUT_MS = 5_000;
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

type S3Request = {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  key?: string;
  queryString?: string;
  body?: Buffer;
  contentType?: string;
};

async function send(request: S3Request): Promise<{ status: number; body: Buffer }> {
  const endpoint = new URL(config.s3.endpoint);
  const basePath = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '';
  const path = `${basePath}${request.key ? `/${encodePath(request.key)}` : ''}` || '/';
  const url = new URL(`${endpoint.origin}${path}${request.queryString ? `?${request.queryString}` : ''}`);
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = request.body ? sha256Hex(body) : EMPTY_SHA256;
  const { stamp, date } = amzDate(new Date());
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (request.contentType) headers['content-type'] = request.contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    request.method,
    url.pathname,
    request.queryString ?? '',
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
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'PUT' ? body : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw storageUnavailable();
  }
  const responseBody = Buffer.from(await response.arrayBuffer());
  if (response.status >= 500) throw storageUnavailable();
  return { status: response.status, body: responseBody };
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send({ method: 'PUT', key, body, contentType });
  if (response.status !== 200) throw storageUnavailable();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send({ method: 'GET', key });
  if (response.status === 404) return null;
  if (response.status !== 200) throw storageUnavailable();
  return response.body;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send({ method: 'DELETE', key });
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
    throw storageUnavailable();
  }
}

/** Start-up bucket check; a missing bucket or an outage must not stop the server. */
export async function bucketReachable(): Promise<boolean> {
  try {
    const response = await send({ method: 'GET', queryString: 'list-type=2&max-keys=1' });
    return response.status === 200;
  } catch {
    return false;
  }
}
