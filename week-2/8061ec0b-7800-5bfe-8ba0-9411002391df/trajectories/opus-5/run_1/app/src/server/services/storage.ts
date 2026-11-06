import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';
import { storageUnavailable } from '../errors';

const REQUEST_TIMEOUT_MS = 8000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

function sign(
  method: string,
  objectKey: string,
  body: Buffer,
  extraHeaders: Record<string, string>,
  query: string,
): SignedRequest {
  const url = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${objectKey === '' ? '' : `/${encodePath(objectKey)}`}`
    : `/${encodePath(objectKey)}`;
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${(headers[name] ?? '').trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `${url.origin}${path}${query === '' ? '' : `?${query}`}`,
    method,
    headers,
    body: body.length > 0 ? new Uint8Array(body) : undefined,
  };
}

async function send(request: SignedRequest): Promise<Response> {
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw storageUnavailable();
  }
}

export async function checkStorageReachable(): Promise<void> {
  const response = await send(sign('GET', '', Buffer.alloc(0), {}, 'list-type=2&max-keys=0'));
  if (response.status !== 200) throw storageUnavailable();
  await response.arrayBuffer();
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send(sign('PUT', key, body, { 'content-type': contentType }, ''));
  await response.arrayBuffer();
  if (response.status !== 200) throw storageUnavailable();
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const response = await send(sign('GET', key, Buffer.alloc(0), {}, ''));
  const buffer = Buffer.from(await response.arrayBuffer());
  if (response.status === 404) return null;
  if (response.status !== 200) throw storageUnavailable();
  return { body: buffer, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send(sign('HEAD', key, Buffer.alloc(0), {}, ''));
  await response.arrayBuffer();
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw storageUnavailable();
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send(sign('DELETE', key, Buffer.alloc(0), {}, ''));
  await response.arrayBuffer();
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) throw storageUnavailable();
}

export async function copyObject(fromKey: string, toKey: string): Promise<void> {
  const source = `/${config.s3.bucket}/${encodePath(fromKey)}`;
  const response = await send(sign('PUT', toKey, Buffer.alloc(0), { 'x-amz-copy-source': source }, ''));
  await response.arrayBuffer();
  if (response.status !== 200) throw storageUnavailable();
}

export function agreementKey(contractId: string): string {
  return `contracts/${contractId}/agreement-signed.pdf`;
}

export function billOfSaleKey(contractId: string): string {
  return `contracts/${contractId}/bill-of-sale.pdf`;
}

export function conditionPhotoKey(contractId: string, eventId: string, photoId: string): string {
  return `contracts/${contractId}/condition/${eventId}/${photoId}.jpg`;
}
