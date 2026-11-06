import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

const timeoutMs = 5000;
const service = 's3';

function sha256(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

type S3Request = {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  key?: string;
  body?: Buffer;
  contentType?: string;
};

function urlFor(key: string | undefined): { url: URL; path: string } {
  const base = new URL(config.s3Endpoint);
  const encodedKey = key === undefined ? '' : key.split('/').map(encodeSegment).join('/');
  const path = config.s3ForcePathStyle
    ? `/${encodeSegment(config.s3Bucket)}${encodedKey === '' ? '' : `/${encodedKey}`}`
    : `/${encodedKey}`;
  const url = new URL(base.origin + path);
  if (!config.s3ForcePathStyle) url.host = `${config.s3Bucket}.${base.host}`;
  return { url, path };
}

async function send(request: S3Request): Promise<Response> {
  const { url, path } = urlFor(request.key);
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = sha256(body);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (request.contentType !== undefined) headers['content-type'] = request.contentType;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [
    request.method,
    path,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3Region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3SecretAccessKey}`, date), config.s3Region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

  try {
    return await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'PUT' ? body : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError('storage_unavailable');
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send({ method: 'HEAD' });
    await response.arrayBuffer();
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send({ method: 'HEAD' });
  await head.arrayBuffer();
  if (head.status === 404) {
    const created = await send({ method: 'PUT' });
    await created.arrayBuffer();
    if (created.status >= 300 && created.status !== 409) throw new ApiError('storage_unavailable');
  } else if (head.status >= 500) {
    throw new ApiError('storage_unavailable');
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send({ method: 'PUT', key, body, contentType });
  await response.arrayBuffer();
  if (!response.ok) throw new ApiError('storage_unavailable');
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send({ method: 'GET', key });
  if (!response.ok) {
    await response.arrayBuffer();
    throw new ApiError('storage_unavailable');
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send({ method: 'DELETE', key });
  await response.arrayBuffer();
  if (!response.ok && response.status !== 404) throw new ApiError('storage_unavailable');
}
