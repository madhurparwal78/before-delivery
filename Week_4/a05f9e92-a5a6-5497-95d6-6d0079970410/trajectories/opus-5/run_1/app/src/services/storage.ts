/**
 * MinIO. Every file lives here, and a file counts as stored only once MinIO
 * accepts the PUT. Requests are signed with AWS Signature Version 4 using the
 * credentials read from the environment.
 */

import { createHash, createHmac } from 'node:crypto';

import { nowMs } from '../clock';
import { connections, settings } from '../config';

const emptyBodySha = createHash('sha256').update('').digest('hex');

let endpointOverride: string | null = null;

export function redirectStorage(endpoint: string | null): void {
  endpointOverride = endpoint;
}

export function storageEndpoint(): string {
  return endpointOverride ?? connections.s3.endpoint;
}

function sha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(at: number): { stamp: string; date: string } {
  const iso = new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp: iso, date: iso.slice(0, 8) };
}

/** Each path segment is encoded, keeping the slashes that separate them. */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function sign(
  method: string,
  objectKey: string | null,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
): SignedRequest {
  const { region, bucket, accessKeyId, secretAccessKey, forcePathStyle } = connections.s3;
  const base = storageEndpoint().replace(/\/$/, '');
  const url = new URL(base);
  const path = forcePathStyle
    ? `/${bucket}${objectKey === null ? '' : `/${encodeKey(objectKey)}`}`
    : `${objectKey === null ? '/' : `/${encodeKey(objectKey)}`}`;
  if (!forcePathStyle) url.hostname = `${bucket}.${url.hostname}`;
  url.pathname = path;

  const payloadHash = body === null ? emptyBodySha : sha256Hex(body);
  const { stamp, date } = amzDate(Date.now());
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };

  const signedNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = signedNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');
  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedNames.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`;
  return { url: url.toString(), headers };
}

async function call(
  method: string,
  objectKey: string | null,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const { url, headers } = sign(method, objectKey, body, extraHeaders);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : new Uint8Array(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

let available = true;
let lastProbe = 0;
const listeners = new Set<(available: boolean) => void>();

export function storageAvailable(): boolean {
  return available;
}

export function onStorageChange(listener: (available: boolean) => void): void {
  listeners.add(listener);
}

function setAvailable(next: boolean): void {
  if (available === next) return;
  available = next;
  for (const listener of listeners) listener(next);
}

/** Storage is unavailable once a probe or any storage call fails. */
export async function probeStorage(): Promise<boolean> {
  lastProbe = nowMs();
  try {
    const response = await call('HEAD', null, null);
    const ok = response.ok || response.status === 404 ? response.ok : false;
    setAvailable(response.ok);
    return ok;
  } catch {
    setAvailable(false);
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    const head = await call('HEAD', null, null);
    if (head.ok) {
      setAvailable(true);
      return;
    }
    const made = await call('PUT', null, Buffer.alloc(0));
    setAvailable(made.ok || made.status === 409);
  } catch {
    setAvailable(false);
  }
}

export function lastProbeAt(): number {
  return lastProbe;
}

export function probeDue(at: number): boolean {
  return at - lastProbe >= settings().STORAGE_RETRY_SECONDS * 1000;
}

export class StorageFailure extends Error {
  constructor(message = 'File storage is unreachable.') {
    super(message);
    this.name = 'StorageFailure';
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    const response = await call('PUT', key, body, { 'content-type': contentType });
    if (!response.ok) {
      setAvailable(false);
      throw new StorageFailure();
    }
    setAvailable(true);
  } catch (e) {
    setAvailable(false);
    throw e instanceof StorageFailure ? e : new StorageFailure();
  }
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
  try {
    const response = await call('GET', key, null);
    if (!response.ok) {
      if (response.status === 404) throw new StorageFailure('No such object.');
      setAvailable(false);
      throw new StorageFailure();
    }
    setAvailable(true);
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  } catch (e) {
    if (e instanceof StorageFailure && e.message === 'No such object.') throw e;
    setAvailable(false);
    throw new StorageFailure();
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await call('DELETE', key, null);
  } catch {
    setAvailable(false);
  }
}

export async function listKeys(prefix: string): Promise<string[]> {
  try {
    const { region, bucket, accessKeyId, secretAccessKey, forcePathStyle } = connections.s3;
    const base = storageEndpoint().replace(/\/$/, '');
    const url = new URL(base);
    url.pathname = forcePathStyle ? `/${bucket}` : '/';
    if (!forcePathStyle) url.hostname = `${bucket}.${url.hostname}`;
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    const { stamp, date } = amzDate(Date.now());
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': emptyBodySha,
      'x-amz-date': stamp,
    };
    const signedNames = Object.keys(headers).sort();
    const canonicalQuery = [...url.searchParams.entries()]
      .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const canonicalRequest = [
      'GET',
      url.pathname,
      canonicalQuery,
      signedNames.map((n) => `${n}:${headers[n]}\n`).join(''),
      signedNames.join(';'),
      emptyBodySha,
    ].join('\n');
    const scope = `${date}/${region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${hmac(signingKey, stringToSign).toString('hex')}`;
    const response = await fetch(url.toString(), { method: 'GET', headers });
    if (!response.ok) {
      setAvailable(false);
      return [];
    }
    const text = await response.text();
    return [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  } catch {
    setAvailable(false);
    return [];
  }
}

/** Object keys, exactly as published. */
export const objectKeys = {
  attachment: (recordNumber: string, attachmentId: string, fileName: string): string =>
    `attachments/${recordNumber}/${attachmentId}/${fileName}`,
  importFile: (importId: string, fileName: string): string => `imports/${importId}/${fileName}`,
  exportFile: (exportId: string): string => `exports/${exportId}.csv`,
  configSet: (setNumber: string): string => `config-sets/${setNumber}.json`,
};
