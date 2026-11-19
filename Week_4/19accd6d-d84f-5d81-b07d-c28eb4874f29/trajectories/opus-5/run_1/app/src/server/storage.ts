import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const EMPTY_SHA = createHash('sha256').update('').digest('hex');

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function uriEncodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part).replaceAll('!', '%21').replaceAll('*', '%2A').replaceAll("'", '%27').replaceAll('(', '%28').replaceAll(')', '%29'))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** Signs one S3 request with AWS Signature Version 4. */
function sign(method: string, key: string, payload: Uint8Array | null): SignedRequest {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const path = forcePathStyle ? `/${bucket}${key === '' ? '/' : `/${key}`}` : `${key === '' ? '/' : `/${key}`}`;
  if (!forcePathStyle) base.host = `${bucket}.${base.host}`;
  const canonicalUri = uriEncodePath(path);
  const url = `${base.origin}${canonicalUri}`;
  const payloadHash = payload === null ? EMPTY_SHA : sha256Hex(payload);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (payload !== null) headers['content-type'] = 'application/octet-stream';
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, headers };
}

export class StorageDown extends Error {}

let forcedDown = false;

export function setStorageOutage(down: boolean): void {
  forcedDown = down;
  healthCheckedAt = 0;
}

export function isStorageForcedDown(): boolean {
  return forcedDown;
}

async function request(
  method: string,
  key: string,
  payload: Uint8Array | null,
  timeoutMs = 5000,
): Promise<{ status: number; body: Uint8Array }> {
  if (forcedDown) throw new StorageDown('storage outage');
  const signed = sign(method, key, payload);
  try {
    const response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload === null ? undefined : payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, body };
  } catch {
    throw new StorageDown('storage unreachable');
  }
}

export async function putObject(key: string, bytes: Uint8Array): Promise<void> {
  const response = await request('PUT', key, bytes);
  if (response.status < 200 || response.status >= 300) throw new StorageDown(`put failed: ${response.status}`);
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  const response = await request('GET', key, null);
  if (response.status === 404) return null;
  if (response.status < 200 || response.status >= 300) throw new StorageDown(`get failed: ${response.status}`);
  return response.body;
}

let healthy = false;
let healthCheckedAt = 0;

/** Reports whether the bucket can be reached, with a one-second cache. */
export async function storageHealthy(): Promise<boolean> {
  if (forcedDown) return false;
  const now = Date.now();
  if (now - healthCheckedAt < 1000) return healthy;
  healthCheckedAt = now;
  try {
    const response = await request('HEAD', '', null, 2000);
    healthy = response.status >= 200 && response.status < 400;
  } catch {
    healthy = false;
  }
  return healthy;
}

export const fileKey = (fileId: string): string => `files/${fileId}`;
export const snapshotInputKey = (token: string): string => `snapshots/${token}/input`;
export const snapshotOutputKey = (token: string): string => `snapshots/${token}/output`;
