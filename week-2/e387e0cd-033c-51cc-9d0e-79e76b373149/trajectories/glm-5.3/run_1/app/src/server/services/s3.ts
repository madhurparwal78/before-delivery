import { createHash, createHmac } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { config } from '../config.js';

// A minimal S3 REST client with SigV4 signing: put, get, head, delete, bucket
// creation. Credentials are used only inside the signature.
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function uriEncode(value: string, encodeSlash: boolean): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%2F/g, encodeSlash ? '%2F' : '/');
}

function s3Url(key: string | undefined): { host: string; path: string; baseUrl: string } {
  const endpoint = new URL(config.s3.endpoint);
  const host = endpoint.host;
  if (config.s3.forcePathStyle) {
    const path = `/${config.s3.bucket}${key !== undefined && key !== '' ? `/${key}` : ''}`;
    return { host, path, baseUrl: `${endpoint.protocol}//${host}` };
  }
  const bucketHost = `${config.s3.bucket}.${host}`;
  return { host: bucketHost, path: key !== undefined && key !== '' ? `/${key}` : '/', baseUrl: `${endpoint.protocol}//${bucketHost}` };
}

export interface S3Success<T> { ok: true; value: T }
export type S3Result<T> = S3Success<T> | { ok: false }

async function s3Request(method: string, key: string | undefined, opts: { body?: Buffer; length?: number; contentType?: string; qs?: string } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  const { host, path } = s3Url(key);
  const url = new URL(config.s3.endpoint);
  const isHttps = url.protocol === 'https:';
  const fullQS = opts.qs !== undefined && opts.qs !== '' ? `?${opts.qs}` : '';
  const canonicalUri = path.split('/').map((segment) => uriEncode(segment, false)).join('/') || '/';
  const bodyPayload = method === 'GET' || method === 'HEAD' || method === 'DELETE' ? 'UNSIGNED-PAYLOAD' : undefined;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = bodyPayload !== undefined ? bodyPayload : (Buffer.isBuffer(opts.body) ? sha256Hex(opts.body) : 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD');

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType;
  if (opts.length !== undefined) headers['content-length'] = String(opts.length);

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h].trim()}\n`).join('');
  const canonicalRequest = [method, canonicalUri, opts.qs ?? '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const reqModule = isHttps ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = reqModule({ hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), method, path: `${canonicalUri}${fullQS}`, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (opts.body !== undefined) {
      if (Buffer.isBuffer(opts.body)) req.end(opts.body);
    } else req.end();
  });
}

export async function ensureBucket(): Promise<void> {
  try {
    const r = await s3Request('HEAD', undefined);
    if (r.status === 200 || r.status === 404) {
      if (r.status === 200) return;
      const create = await s3Request('PUT', undefined, { length: 0 });
      if (create.status === 200) return;
    }
  } catch {
    // retried by the background worker
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<S3Result<null>> {
  try {
    const r = await s3Request('PUT', key, { body, length: body.length, contentType });
    if (r.status >= 200 && r.status < 300) return { ok: true, value: null };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function getObject(key: string): Promise<S3Result<Buffer>> {
  try {
    const r = await s3Request('GET', key);
    if (r.status === 200) return { ok: true, value: r.body };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function deleteObject(key: string): Promise<S3Result<null>> {
  try {
    const r = await s3Request('DELETE', key);
    if (r.status >= 200 && r.status < 300) return { ok: true, value: null };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return null;
  }
}
