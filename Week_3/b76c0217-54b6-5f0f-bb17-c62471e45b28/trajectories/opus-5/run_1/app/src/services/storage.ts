import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';
import { isDown } from './outage';

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('File storage is unavailable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest();

const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const encodeKey = (key: string): string => key.split('/').map(encodeSegment).join('/');

function signedHeaders(
  method: string,
  url: URL,
  payloadHash: string,
  extra: Record<string, string>,
): Record<string, string> {
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extra,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaderList = names.join(';');
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.storage.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, date), config.storage.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`,
  };
}

function objectUrl(key: string): URL {
  const base = config.storage.endpoint.replace(/\/$/, '');
  const path = config.storage.forcePathStyle
    ? `${base}/${config.storage.bucket}${key === '' ? '' : `/${encodeKey(key)}`}`
    : `${base}${key === '' ? '/' : `/${encodeKey(key)}`}`;
  return new URL(path);
}

async function send(
  method: string,
  key: string,
  body?: Buffer,
  contentType?: string,
): Promise<Response> {
  if (isDown('storage')) throw new StorageUnavailable();
  const url = objectUrl(key);
  const payload = body ?? Buffer.alloc(0);
  const extra: Record<string, string> = contentType === undefined ? {} : { 'content-type': contentType };
  const headers = signedHeaders(method, url, sha256(payload), extra);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(payload),
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    throw new StorageUnavailable(error);
  }
  return response;
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '');
  if (head.ok) return;
  const created = await send('PUT', '');
  if (!created.ok && created.status !== 409) throw new StorageUnavailable(created.status);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', key, body, contentType);
  if (!response.ok) throw new StorageUnavailable(response.status);
  await response.arrayBuffer();
}

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export async function getObject(key: string): Promise<StoredObject> {
  const response = await send('GET', key);
  if (!response.ok) throw new StorageUnavailable(response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export const snapshotPageKey = (
  siteId: string,
  versionId: string,
  snapshotId: string,
  pagePath: string,
): string => `sites/${siteId}/versions/${versionId}/snapshots/${snapshotId}/pages/${pagePath}.html`;

export const snapshotManifestKey = (
  siteId: string,
  versionId: string,
  snapshotId: string,
): string => `sites/${siteId}/versions/${versionId}/snapshots/${snapshotId}/manifest.json`;

export const openapiKey = (siteId: string, versionId: string, importId: string): string =>
  `sites/${siteId}/versions/${versionId}/openapi/${importId}.json`;

export const assetKey = (siteId: string, imageId: string): string =>
  `sites/${siteId}/assets/${imageId}`;
