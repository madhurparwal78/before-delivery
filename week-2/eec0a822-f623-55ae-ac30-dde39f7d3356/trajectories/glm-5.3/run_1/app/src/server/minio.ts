import { createHash, createHmac } from 'node:crypto';
import type { Config } from './config.js';

export class StorageUnavailable extends Error {}

function hmac(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('base64');
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').toLowerCase();
}

function uriEncode(s: string, encodeSlash = true): string {
  let out = '';
  for (const ch of s) {
    if (/[A-Za-z0-9_.~\-]/.test(ch)) out += ch;
    else if (ch === '/') out += encodeSlash ? '%2F' : '/';
    else out += '%' + Buffer.from(ch, 'utf8').toString('hex').toUpperCase().match(/../g)!.join('%');
  }
  return out;
}

interface S3Fetch {
  status: number;
  headers: Headers;
  text: () => Promise<string>;
}

async function s3Request(config: Config, method: string, key: string | null, body: Buffer | null, contentType: string | null, extraHeaders: Record<string, string> = {}): Promise<S3Fetch> {
  const host = new URL(config.s3.endpoint).host;
  const path = config.s3.forcePathStyle ? `/${config.s3.bucket}${key ? '/' + key : ''}` : `/${config.s3.bucket}${key ? '/' + key : ''}`;
  const canonicalUri = key ? '/' + uriEncode(key, false) : '/';
  const hostHeader = config.s3.forcePathStyle ? host : `${config.s3.bucket}.${host}`;
  const pathForUrl = config.s3.forcePathStyle ? `/${config.s3.bucket}${key ? '/' + key : ''}` : `/${config.s3.bucket}${key ? '/' + key : ''}`;
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: hostHeader,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  if (contentType) headers['content-type'] = contentType;
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = headerNames.join(';');
  const canonicalRequest = [method, canonicalUri === '/' && path ? '/' : canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(Buffer.from(canonicalRequest))].join('\n');
  const kDate = createHmac('sha256', `AWS4${config.s3.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(config.s3.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = config.s3.endpoint.replace(/\/$/, '') + pathForUrl;
  try {
    const res = await fetch(url, {
      method,
      headers: { ...headers, Authorization: authorization },
      body: body ?? undefined,
      signal: AbortSignal.timeout(15000),
    });
    return { status: res.status, headers: res.headers, text: () => res.text() };
  } catch {
    throw new StorageUnavailable();
  }
}

async function ensureBucket(config: Config): Promise<void> {
  const res = await s3Request(config, 'PUT', null, Buffer.alloc(0), null);
  if (res.status !== 200 && res.status !== 409) {
    const err = await res.text().catch(() => '');
    throw new Error(`bucket create failed: ${res.status} ${err}`);
  }
}

let bucketReady = false;

export async function initStorage(config: Config): Promise<void> {
  const retries = 30;
  for (let i = 0; i < retries; i++) {
    try {
      await ensureBucket(config);
      bucketReady = true;
      return;
    } catch (e) {
      if (e instanceof StorageUnavailable) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw e;
    }
  }
  throw new Error('MinIO unreachable');
}

export async function putObject(config: Config, key: string, body: Buffer, contentType: string): Promise<void> {
  await s3Request(config, 'PUT', key, body, contentType);
}

export async function getObjectBytes(config: Config, key: string): Promise<{ body: Buffer | null; contentType: string | null }> {
  const url = config.s3.endpoint.replace(/\/$/, '') + '/' + config.s3.bucket + '/' + key.split('/').map((part) => uriEncode(part)).join('/');
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return { body: null, contentType: null };
    if (res.status !== 200) throw new StorageUnavailable();
    const body = Buffer.from(await res.arrayBuffer());
    return { body, contentType: res.headers.get('content-type') };
  } catch (e) {
    if (e instanceof StorageUnavailable) throw e;
    throw new StorageUnavailable();
  }
}

export async function deleteObject(config: Config, key: string): Promise<void> {
  await s3Request(config, 'DELETE', key, null, null);
}

export async function headBucket(config: Config): Promise<boolean> {
  try {
    const res = await s3Request(config, 'HEAD', null, null, null);
    return res.status === 200;
  } catch {
    return false;
  }
}

export { uriEncode, hmac };
