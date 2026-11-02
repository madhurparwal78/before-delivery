import { createHash, createHmac } from 'node:crypto';
import { env } from '../env.js';

export class S3Unavailable extends Error {}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function signedHeaders(headers: Record<string, string>): string {
  return Object.keys(headers).sort().join(';');
}

function canonicalHeaders(headers: Record<string, string>): string {
  return Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k].trim()}\n`)
    .join('');
}

async function s3(
  method: string,
  path: string,
  body: Buffer,
  contentType?: string
): Promise<{ status: number; body: Buffer }> {
  const url = new URL(env.s3.endpoint);
  const host = url.host;
  const canonicalUri = `/${env.s3.bucket}/${path}`.replace(/\/+/g, '/');
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const datestamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  const canonical = [
    method,
    canonicalUri,
    '',
    canonicalHeaders(headers),
    signedHeaders(headers),
    payloadHash,
  ].join('\n');
  const scope = `${datestamp}/${env.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const kDate = hmac('AWS4' + env.s3.secretAccessKey, datestamp);
  const kRegion = hmac(kDate, env.s3.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders(headers)}, Signature=${signature}`;
  let res: Response;
  try {
    res = await fetch(`${env.s3.endpoint}${canonicalUri}`, {
      method,
      headers: { ...headers, Authorization: authorization },
      body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new S3Unavailable();
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status === 404) return { status: 404, body: buf };
  if (res.status >= 400) throw new S3Unavailable();
  return { status: res.status, body: buf };
}

export async function putObject(path: string, data: Buffer, contentType: string): Promise<void> {
  await s3('PUT', path, data, contentType);
}

export async function getObject(path: string): Promise<{ data: Buffer; contentType: string } | null> {
  const res = await s3('GET', path, Buffer.alloc(0));
  if (res.status === 404) return null;
  const head = await s3('HEAD', path, Buffer.alloc(0));
  return {
    data: res.body,
    contentType: head.body.length === 0 ? 'application/octet-stream' : 'application/octet-stream',
  };
}

export async function objectExists(path: string): Promise<boolean> {
  try {
    const res = await s3('HEAD', path, Buffer.alloc(0));
    return res.status === 200;
  } catch (e) {
    if (e instanceof S3Unavailable) throw e;
    return false;
  }
}
