import { createHash, createHmac } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { SIGNED_LINK_SECONDS, config } from '../config';

const UNSIGNED = 'UNSIGNED-PAYLOAD';
const ALGORITHM = 'AWS4-HMAC-SHA256';

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/');
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function signingKey(date: string): Buffer {
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

const endpoint = new URL(config.s3.endpoint);
const transport = endpoint.protocol === 'https:' ? https : http;
const endpointPort = endpoint.port !== '' ? Number.parseInt(endpoint.port, 10) : endpoint.protocol === 'https:' ? 443 : 80;

function objectPath(key: string): string {
  return config.s3.forcePathStyle ? `/${config.s3.bucket}/${key}` : `/${key}`;
}

function bucketPath(): string {
  return config.s3.forcePathStyle ? `/${config.s3.bucket}` : '/';
}

function hostHeader(): string {
  const base = config.s3.forcePathStyle ? endpoint.hostname : `${config.s3.bucket}.${endpoint.hostname}`;
  const defaultPort = endpoint.protocol === 'https:' ? 443 : 80;
  return endpointPort === defaultPort ? base : `${base}:${endpointPort}`;
}

interface S3Result {
  statusCode: number;
  body: Buffer;
}

async function send(
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
  path: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 8000,
): Promise<S3Result> {
  const now = new Date();
  const { stamp, date } = amzDate(now);
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host: hostHeader(),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, encodePath(path), '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(date), stringToSign).toString('hex');
  headers['authorization'] = `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  if (payload.length > 0) headers['content-length'] = String(payload.length);

  return new Promise<S3Result>((resolve, reject) => {
    const request = transport.request(
      { host: endpoint.hostname, port: endpointPort, method, path: encodePath(path), headers, timeout: timeoutMs },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
        response.on('error', reject);
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error('s3 timeout')));
    request.on('error', reject);
    if (payload.length > 0) request.write(payload);
    request.end();
  });
}

export class StorageUnavailable extends Error {
  constructor() {
    super('Object storage is unreachable');
  }
}

export async function probeBucket(): Promise<boolean> {
  try {
    const result = await send('HEAD', bucketPath(), Buffer.alloc(0), {}, 4000);
    return result.statusCode === 200 || result.statusCode === 404 || result.statusCode === 403;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    const head = await send('HEAD', bucketPath(), Buffer.alloc(0), {}, 4000);
    if (head.statusCode === 404) await send('PUT', bucketPath(), Buffer.alloc(0), {}, 6000);
  } catch {
    // Storage is unreachable at boot; the health probe reports the outage and the bucket is made later.
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let result: S3Result;
  try {
    result = await send('PUT', objectPath(key), body, { 'content-type': contentType });
  } catch {
    throw new StorageUnavailable();
  }
  if (result.statusCode === 404) {
    await send('PUT', bucketPath(), Buffer.alloc(0), {}, 6000);
    const retry = await send('PUT', objectPath(key), body, { 'content-type': contentType });
    if (retry.statusCode < 200 || retry.statusCode >= 300) throw new StorageUnavailable();
    return;
  }
  if (result.statusCode < 200 || result.statusCode >= 300) throw new StorageUnavailable();
}

export async function deleteObject(key: string): Promise<void> {
  let result: S3Result;
  try {
    result = await send('DELETE', objectPath(key), Buffer.alloc(0));
  } catch {
    throw new StorageUnavailable();
  }
  if (result.statusCode !== 204 && result.statusCode !== 200 && result.statusCode !== 404) {
    throw new StorageUnavailable();
  }
}

export async function objectExists(key: string): Promise<boolean> {
  const result = await send('HEAD', objectPath(key), Buffer.alloc(0));
  return result.statusCode === 200;
}

/** A GET link that expires 300 seconds after it is issued. */
export function signedGetUrl(key: string): string {
  const now = new Date();
  const { stamp, date } = amzDate(now);
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const host = hostHeader();
  const query = new Map<string, string>([
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${config.s3.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(SIGNED_LINK_SECONDS)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  const canonicalQuery = [...query.entries()]
    .map(([key_, value]) => [encodeSegment(key_), encodeSegment(value)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key_, value]) => `${key_}=${value}`)
    .join('&');
  const path = encodePath(objectPath(key));
  const canonicalRequest = ['GET', path, canonicalQuery, `host:${host}\n`, 'host', UNSIGNED].join('\n');
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(date), stringToSign).toString('hex');
  return `${config.s3.endpoint}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
