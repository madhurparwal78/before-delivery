import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { ApiError } from './errors.js';

const outages = new Map<string, number>();

export function setStorageOutage(workspaceId: string, ms: number): void {
  outages.set(workspaceId, Date.now() + ms);
}

function outageActive(workspaceId: string): boolean {
  const until = outages.get(workspaceId);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    outages.delete(workspaceId);
    return false;
  }
  return true;
}

export const storageUnavailable = (): ApiError =>
  new ApiError(503, 'storage_unavailable', 'File storage is unavailable.');

function hash(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function signingKey(date: string): Buffer {
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function objectUrl(key: string): URL {
  const base = config.s3.endpoint.replace(/\/+$/, '');
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return config.s3.forcePathStyle
    ? new URL(`${base}/${config.s3.bucket}/${encoded}`)
    : new URL(`${base}/${encoded}`);
}

function signedHeaders(
  method: string,
  url: URL,
  payload: Buffer,
  extra: Record<string, string>,
): Record<string, string> {
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]|\.\d{3}/g, '')}`;
  const date = amzDate.slice(0, 8);
  const payloadHash = hash(payload);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extra,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${String(headers[name] ?? headers[name.toLowerCase()]).trim()}\n`)
    .join('');
  const signedHeaderList = names.join(';');
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(date), toSign).toString('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaderList}, Signature=${signature}`;
  return headers;
}

async function send(
  method: 'PUT' | 'GET',
  key: string,
  payload: Buffer,
  contentType?: string,
): Promise<Response> {
  const url = objectUrl(key);
  const extra: Record<string, string> = {};
  if (contentType !== undefined) extra['content-type'] = contentType;
  const headers = signedHeaders(method, url, payload, extra);
  return fetch(url, {
    method,
    headers,
    body: method === 'PUT' ? new Uint8Array(payload) : undefined,
    signal: AbortSignal.timeout(2500),
  });
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

const held = new Map<string, StoredObject>();

/** Bytes this process already holds from writing or serving an object. */
export function heldObject(key: string): StoredObject | undefined {
  return held.get(key);
}

export async function putObject(
  workspaceId: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (outageActive(workspaceId)) throw storageUnavailable();
  let response: Response;
  try {
    response = await send('PUT', key, body, contentType);
  } catch {
    throw storageUnavailable();
  }
  if (!response.ok) throw storageUnavailable();
  held.set(key, { body, contentType });
}

export async function getObject(workspaceId: string, key: string): Promise<StoredObject> {
  if (outageActive(workspaceId)) throw storageUnavailable();
  let response: Response;
  try {
    response = await send('GET', key, Buffer.alloc(0));
  } catch {
    throw storageUnavailable();
  }
  if (response.status === 404) throw new ApiError(404, 'not_found', 'Not found.');
  if (!response.ok) throw storageUnavailable();
  const body = Buffer.from(await response.arrayBuffer());
  const stored: StoredObject = {
    body,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
  held.set(key, stored);
  return stored;
}

export async function storageReachable(workspaceId: string): Promise<boolean> {
  if (outageActive(workspaceId)) return false;
  try {
    const response = await send('GET', `health/${workspaceId}.probe`, Buffer.alloc(0));
    return response.status === 404 || response.ok;
  } catch {
    return false;
  }
}

export const imageKey = (workspaceId: string, imageId: string): string =>
  `images/${workspaceId}/${imageId}`;
export const snapshotKey = (pageId: string, publishId: string): string =>
  `snapshots/${pageId}/${publishId}.html`;
export const snapshotAssetKey = (pageId: string, publishId: string, imageId: string): string =>
  `snapshots/${pageId}/${publishId}/assets/${imageId}`;
