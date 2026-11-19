import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { config } from '../config.js';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const REQUEST_TIMEOUT_MS = 2500;

export interface S3Response {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export class StorageUnreachable extends Error {
  constructor(cause: string) {
    super(`storage unreachable: ${cause}`);
  }
}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function signingKey(date: string): Buffer {
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

interface S3RequestOptions {
  method: 'GET' | 'PUT' | 'HEAD' | 'POST' | 'DELETE';
  /** Object key, or the empty string for a bucket-level request. */
  key: string;
  query?: Record<string, string>;
  body?: Buffer;
  extraHeaders?: Record<string, string>;
}

export async function s3Request(options: S3RequestOptions): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const body = options.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const { stamp, date } = amzDate(new Date());

  const bucketPath = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '';
  const objectPath = options.key.length > 0 ? `/${encodePath(options.key)}` : '';
  const canonicalUri = `${bucketPath}${objectPath}` || '/';
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;

  const query = options.query ?? {};
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k] ?? '')}`)
    .join('&');

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...options.extraHeaders,
  };
  if (body.byteLength > 0 || options.method === 'PUT') {
    headers['content-length'] = String(body.byteLength);
  }

  const headerNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = headerNames
    .map((name) => {
      const value = Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1] ?? '';
      return `${name}:${value.trim()}\n`;
    })
    .join('');
  const signedHeaders = headerNames.join(';');

  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(date)).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const send = endpoint.protocol === 'https:' ? httpsRequest : httpRequest;
  const path = canonicalQuery.length > 0 ? `${canonicalUri}?${canonicalQuery}` : canonicalUri;

  return await new Promise<S3Response>((resolve, reject) => {
    const req = send(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port,
        method: options.method,
        path,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const flat: Record<string, string> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            flat[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value ?? '');
          }
          resolve({ status: res.statusCode ?? 0, headers: flat, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new StorageUnreachable('timeout'));
    });
    req.on('error', (error: Error) => reject(new StorageUnreachable(error.message)));
    if (body.byteLength > 0) req.write(body);
    req.end();
  });
}

export const modelKey = (modelId: string): string => `models/${modelId}.glb`;

export async function ensureBucket(): Promise<void> {
  const head = await s3Request({ method: 'HEAD', key: '' });
  if (head.status === 404) await s3Request({ method: 'PUT', key: '' });
}

export interface StoredConfirmation {
  bytes: number;
  sha256: string;
}

/**
 * Puts the object and then asks MinIO to confirm the byte length and SHA-256
 * before the caller may treat the model as stored.
 */
export async function putModel(modelId: string, bytes: Buffer): Promise<StoredConfirmation> {
  const digest = createHash('sha256').update(bytes).digest();
  const put = await s3Request({
    method: 'PUT',
    key: modelKey(modelId),
    body: bytes,
    extraHeaders: {
      'content-type': 'model/gltf-binary',
      'x-amz-checksum-sha256': digest.toString('base64'),
    },
  });
  if (put.status < 200 || put.status >= 300) throw new StorageUnreachable(`put ${put.status}`);

  const head = await s3Request({
    method: 'HEAD',
    key: modelKey(modelId),
    extraHeaders: { 'x-amz-checksum-mode': 'ENABLED' },
  });
  if (head.status !== 200) throw new StorageUnreachable(`head ${head.status}`);
  const confirmedBytes = Number(head.headers['content-length'] ?? '-1');
  const confirmedChecksum = head.headers['x-amz-checksum-sha256'] ?? '';
  if (confirmedBytes !== bytes.byteLength) throw new StorageUnreachable('length mismatch');
  if (confirmedChecksum !== digest.toString('base64')) throw new StorageUnreachable('checksum mismatch');
  return { bytes: confirmedBytes, sha256: digest.toString('hex') };
}

export async function getModel(modelId: string): Promise<Buffer | null> {
  const got = await s3Request({ method: 'GET', key: modelKey(modelId) });
  if (got.status === 404) return null;
  if (got.status !== 200) throw new StorageUnreachable(`get ${got.status}`);
  return got.body;
}

/** True when MinIO confirms the object's length. */
export async function modelConfirmed(modelId: string, bytes: number): Promise<boolean> {
  const head = await s3Request({ method: 'HEAD', key: modelKey(modelId) });
  if (head.status !== 200) return false;
  return Number(head.headers['content-length'] ?? '-1') === bytes;
}

export async function storageAnswers(): Promise<boolean> {
  try {
    const head = await s3Request({ method: 'HEAD', key: '' });
    return head.status >= 200 && head.status < 500;
  } catch {
    return false;
  }
}
