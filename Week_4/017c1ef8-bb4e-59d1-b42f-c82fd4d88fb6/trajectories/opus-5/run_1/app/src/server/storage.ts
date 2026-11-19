import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { config } from './config';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

type S3Response = { status: number; body: Buffer; headers: Record<string, string> };

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function objectUrl(key: string): URL {
  const base = new URL(config.s3.endpoint);
  const encoded = encodeKey(key);
  if (config.s3.forcePathStyle) {
    base.pathname = `/${config.s3.bucket}/${encoded}`;
  } else {
    base.host = `${config.s3.bucket}.${base.host}`;
    base.pathname = `/${encoded}`;
  }
  return base;
}

function signedHeaders(
  method: string,
  url: URL,
  payload: Buffer,
  extra: Record<string, string>,
): Record<string, string> {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = payload.length === 0 ? EMPTY_SHA256 : sha256Hex(payload);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extra,
  };

  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${String(headers[name] ?? headers[name.toLowerCase()]).trim()}\n`)
    .join('');
  const signedHeaderList = sortedNames.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaderList}, Signature=${signature}`;
  return headers;
}

function send(
  method: string,
  url: URL,
  payload: Buffer,
  extra: Record<string, string>,
  timeoutMs: number,
): Promise<S3Response> {
  const headers = signedHeaders(method, url, payload, extra);
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = transport(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        method,
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, 'content-length': String(payload.length) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const flat: Record<string, string> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') flat[name] = value;
          }
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: flat });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('storage_timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

export class StorageUnavailable extends Error {}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let res: S3Response;
  try {
    res = await send('PUT', objectUrl(key), body, { 'content-type': contentType }, 5000);
  } catch {
    throw new StorageUnavailable();
  }
  if (res.status < 200 || res.status >= 300) throw new StorageUnavailable();
}

export async function headObjectSize(key: string): Promise<number> {
  let res: S3Response;
  try {
    res = await send('HEAD', objectUrl(key), Buffer.alloc(0), {}, 5000);
  } catch {
    throw new StorageUnavailable();
  }
  if (res.status !== 200) throw new StorageUnavailable();
  return Number(res.headers['content-length'] ?? '-1');
}

export async function getObject(key: string): Promise<Buffer> {
  let res: S3Response;
  try {
    res = await send('GET', objectUrl(key), Buffer.alloc(0), {}, 5000);
  } catch {
    throw new StorageUnavailable();
  }
  if (res.status !== 200) throw new StorageUnavailable();
  return res.body;
}

/** Health checks storage on each call, with a timeout of at most 2 seconds. */
export async function storageReachable(): Promise<boolean> {
  const url = new URL(config.s3.endpoint);
  url.pathname = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '/';
  url.searchParams.set('max-keys', '0');
  if (!config.s3.forcePathStyle) url.host = `${config.s3.bucket}.${url.host}`;
  try {
    const res = await send('GET', url, Buffer.alloc(0), {}, 2000);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}
