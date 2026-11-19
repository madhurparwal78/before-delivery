import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageUnavailable extends Error {}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function amzDate(now: Date): { long: string; short: string } {
  const long = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { long, short: long.slice(0, 8) };
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  key: string,
  payloadHash: string,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${encodeKey(key)}`
    : `/${encodeKey(key)}`;
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;
  const { long, short } = amzDate(new Date());

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': long,
    ...extraHeaders,
  };

  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => {
      const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
      return `${name}:${value.trim()}\n`;
    })
    .join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${short}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, long, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, short);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.Authorization = `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.protocol}//${endpoint.host}${path}`, headers };
}

async function call(
  method: string,
  key: string,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const payloadHash = body === null ? sha256Hex('') : sha256Hex(body);
  const signed = signRequest(method, key, payloadHash, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body === null ? undefined : new Uint8Array(body),
    });
  } catch (error) {
    throw new StorageUnavailable(error instanceof Error ? error.message : 'storage unreachable');
  }
}

function assertReachable(response: Response): void {
  if (response.status >= 500) throw new StorageUnavailable(`storage status ${response.status}`);
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const response = await call('PUT', key, body, {
    'content-type': contentType,
    'content-length': String(body.length),
  });
  assertReachable(response);
  if (!response.ok) throw new StorageUnavailable(`storage refused put ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await call('GET', key, null);
  assertReachable(response);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`storage refused get ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await call('HEAD', key, null);
  assertReachable(response);
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageUnavailable(`storage refused head ${response.status}`);
  return true;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call('DELETE', key, null);
  assertReachable(response);
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
    throw new StorageUnavailable(`storage refused delete ${response.status}`);
  }
}

export function originalKey(accountId: string, modelId: string): string {
  return `models/${accountId}/${modelId}/original.glb`;
}

export function thumbnailKey(accountId: string, modelId: string): string {
  return `models/${accountId}/${modelId}/thumbnail.png`;
}
