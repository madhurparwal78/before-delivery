/**
 * MinIO. Every object lives in the private bucket, under a generated key, and
 * is only ever reached through a 302 to a signed GET URL that expires sixty
 * seconds after it is issued. The bucket never gets a public policy.
 */

import { createHash, createHmac } from 'node:crypto';
import { SERVICE_TIMEOUT_MS, config } from '../config.js';

export const SIGNED_URL_TTL_SECONDS = 60;

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('storage_unavailable');
    this.cause = cause;
  }
}

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986 encoding, with `/` kept as a path separator when asked. */
function uriEncode(value: string, keepSlashes: boolean): string {
  let out = '';
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) out += char;
    else if (char === '/' && keepSlashes) out += '/';
    else {
      for (const byte of Buffer.from(char, 'utf8')) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(dateStamp: string): Buffer {
  const dateKey = hmac(`AWS4${config.storage.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.storage.region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function credentialScope(dateStamp: string): string {
  return `${dateStamp}/${config.storage.region}/s3/aws4_request`;
}

const endpoint = new URL(config.storage.endpoint);

/** Path-style keeps the bucket in the path, which is how MinIO is addressed here. */
function canonicalPath(key: string | null): string {
  const bucket = uriEncode(config.storage.bucket, false);
  const object = key === null ? '' : `/${uriEncode(key, true)}`;
  return config.storage.forcePathStyle ? `/${bucket}${object}` : object === '' ? '/' : object;
}

function hostHeader(): string {
  if (config.storage.forcePathStyle) return endpoint.host;
  return `${config.storage.bucket}.${endpoint.host}`;
}

function originFor(): string {
  if (config.storage.forcePathStyle) return `${endpoint.protocol}//${endpoint.host}`;
  return `${endpoint.protocol}//${config.storage.bucket}.${endpoint.host}`;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  key: string | null,
  payload: Buffer,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const { amzDate, dateStamp } = amzDates(new Date());
  const payloadHash = payload.length === 0 ? EMPTY_SHA256 : sha256Hex(payload);
  const headers: Record<string, string> = {
    host: hostHeader(),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    canonicalPath(key),
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope(dateStamp),
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmac(signingKey(dateStamp), stringToSign).toString('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${credentialScope(dateStamp)}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${originFor()}${canonicalPath(key)}`, headers };
}

async function send(
  method: string,
  key: string | null,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, key, payload, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload.length === 0 ? undefined : payload,
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new StorageUnavailable(cause);
  }
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const response = await send('PUT', key, bytes, {
    'content-type': contentType,
    'content-length': String(bytes.length),
  });
  if (!response.ok) throw new StorageUnavailable(`PUT ${key} answered ${response.status}`);
}

/**
 * Confirms storage is answering before a file link is handed out, so that a
 * link answers `storage_unavailable` while MinIO is unreachable. Any HTTP
 * reply means storage is up.
 */
export async function assertStorageReachable(key: string): Promise<void> {
  await send('HEAD', key, Buffer.alloc(0));
}

/** A short-lived signed GET URL. Issued only after an ownership or live-link check. */
export function presignGetUrl(key: string): string {
  const { amzDate, dateStamp } = amzDates(new Date());
  const query = new URLSearchParams([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${config.storage.accessKeyId}/${credentialScope(dateStamp)}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(SIGNED_URL_TTL_SECONDS)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  const canonicalQuery = [...query.entries()]
    .map(([name, value]) => [uriEncode(name, false), uriEncode(value, false)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    canonicalPath(key),
    canonicalQuery,
    `host:${hostHeader()}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope(dateStamp),
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmac(signingKey(dateStamp), stringToSign).toString('hex');
  return `${originFor()}${canonicalPath(key)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Creates the private bucket when it is not there yet. Never sets a policy. */
export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', null, Buffer.alloc(0));
  if (head.ok) return;
  if (head.status !== 404) {
    throw new StorageUnavailable(`HEAD bucket answered ${head.status}`);
  }
  const created = await send('PUT', null, Buffer.alloc(0));
  if (!created.ok && created.status !== 409) {
    throw new StorageUnavailable(`PUT bucket answered ${created.status}`);
  }
}

export const documentObjectKey = (
  renterId: string,
  documentId: string,
  extension: string,
): string => `renters/${renterId}/documents/${documentId}.${extension}`;

export const statementObjectKey = (
  renterId: string,
  month: string,
  statementId: string,
): string => `renters/${renterId}/statements/${month}-${statementId}.pdf`;
