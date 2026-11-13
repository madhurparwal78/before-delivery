import { createHash, createHmac } from 'node:crypto';
import { env } from '../env.js';
import { ApiError } from '../http/errors.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 5_000;
export const SIGNED_LINK_SECONDS = 60;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(dateStamp: string): Buffer {
  const dateKey = hmac(`AWS4${env.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, env.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function resourcePath(key: string | null): string {
  const bucketPart = env.s3.forcePathStyle ? `/${env.s3.bucket}` : '';
  return key === null ? `${bucketPart}/` : `${bucketPart}/${encodeKeyPath(key)}`;
}

function endpointHost(): string {
  return new URL(env.s3.endpoint).host;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(method: string, key: string | null, payload: Buffer, contentType?: string): SignedRequest {
  const now = new Date();
  const { amzDate, dateStamp } = stamps(now);
  const path = resourcePath(key);
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host: endpointHost(),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType !== undefined) headers['content-type'] = contentType;
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${headers[name] as string}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${env.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(dateStamp), stringToSign).toString('hex');
  headers['authorization'] =
    `${ALGORITHM} Credential=${env.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${env.s3.endpoint}${path}`, headers };
}

async function call(
  method: string,
  key: string | null,
  payload: Buffer,
  contentType?: string,
): Promise<number> {
  const signed = signRequest(method, key, payload, contentType);
  const init: RequestInit = {
    method,
    headers: signed.headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (payload.length > 0) init.body = payload;
  const response = await fetch(signed.url, init);
  await response.arrayBuffer();
  return response.status;
}

function unavailable(): ApiError {
  return new ApiError('storage_unavailable');
}

async function ensureBucket(): Promise<void> {
  const status = await call('HEAD', null, Buffer.alloc(0));
  if (status === 404) {
    const created = await call('PUT', null, Buffer.alloc(0));
    if (created >= 300 && created !== 409) throw unavailable();
    return;
  }
  if (status >= 300) throw unavailable();
}

export function credentialObjectKey(interpreterId: string, credentialId: string, extension: string): string {
  return `credentials/${interpreterId}/${credentialId}.${extension}`;
}

export async function putCertificate(key: string, content: Buffer, contentType: string): Promise<void> {
  try {
    await ensureBucket();
    const status = await call('PUT', key, content, contentType);
    if (status >= 300) throw unavailable();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}

/** Confirms the object is readable, so an unreachable store answers storage_unavailable. */
export async function assertCertificateReadable(key: string): Promise<void> {
  let status: number;
  try {
    status = await call('HEAD', key, Buffer.alloc(0));
  } catch {
    throw unavailable();
  }
  if (status >= 300) throw unavailable();
}

/** A presigned GET URL valid for 60 seconds. */
export function signedCertificateUrl(key: string): string {
  const now = new Date();
  const { amzDate, dateStamp } = stamps(now);
  const scope = `${dateStamp}/${env.s3.region}/${SERVICE}/aws4_request`;
  const path = resourcePath(key);
  const parameters = new URLSearchParams([
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${env.s3.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(SIGNED_LINK_SECONDS)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  parameters.sort();
  const canonicalRequest = [
    'GET',
    path,
    parameters.toString(),
    `host:${endpointHost()}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(dateStamp), stringToSign).toString('hex');
  parameters.append('X-Amz-Signature', signature);
  return `${env.s3.endpoint}${path}?${parameters.toString()}`;
}
