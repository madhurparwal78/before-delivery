import { createHash, createHmac } from 'node:crypto';
import { config } from './util.js';

export class StorageError extends Error {}

export interface S3Object {
  body: Buffer;
  contentType: string;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function uriEncode(value: string, encodeSlash = true): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, encodeSlash ? '%2F' : '/');
}

export interface S3Response {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export async function s3Request(
  method: string,
  objectKey: string,
  body: Buffer | null = null,
  contentType = 'application/octet-stream',
  timeoutMs = 15_000,
): Promise<S3Response> {
  const endpointUrl = new URL(config.s3.endpoint);
  const host = endpointUrl.hostname;
  const port = endpointUrl.port || (endpointUrl.protocol === 'https:' ? '443' : '80');
  const canonicalHost = endpointUrl.port ? `${host}:${port}` : host;
  const path = `/${config.s3.bucket}/${objectKey.split('/').map((p) => uriEncode(p, false)).join('/')}`;
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: canonicalHost,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (body !== null) headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join('');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(Buffer.from(`AWS4${config.s3.secretAccessKey}`, 'utf8'), dateStamp);
  const kRegion = hmac(kDate, config.s3.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpointUrl.protocol}//${canonicalHost}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit = {
      method,
      headers: { ...headers, Authorization: authorization },
      signal: controller.signal,
    };
    if (body !== null) {
      init.body = body;
    }
    const res = await fetch(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: buf,
    };
  } catch (err) {
    throw new StorageError(`Storage request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function storageHealthy(): Promise<boolean> {
  try {
    const res = await s3Request('GET', '.portal', null, 'application/octet-stream', 1_500);
    return res.status === 200 || res.status === 404 || res.status === 403;
  } catch {
    return false;
  }
}

export async function putObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
  const res = await s3Request('PUT', objectKey, body, contentType);
  if (res.status !== 200) {
    throw new StorageError(`Put object failed with ${res.status}`);
  }
}

export async function getObject(objectKey: string): Promise<S3Object | null> {
  const res = await s3Request('GET', objectKey);
  if (res.status === 404) return null;
  if (res.status !== 200) {
    throw new StorageError(`Get object failed with ${res.status}`);
  }
  return { body: res.body, contentType: res.headers['content-type'] ?? 'application/octet-stream' };
}

export async function objectExists(objectKey: string): Promise<boolean> {
  const res = await s3Request('HEAD', objectKey);
  return res.status === 200;
}

export function folderMarkerKey(orderId: string): string {
  return `portal/${orderId}/.portal`;
}

export function assetKey(orderId: string, fileId: string, name: string): string {
  return `portal/${orderId}/assets/${fileId}/${name}`;
}

export function deliverableKey(orderId: string, fileId: string, name: string): string {
  return `portal/${orderId}/deliverables/${fileId}/${name}`;
}

export function invoiceKey(orderId: string, killbillInvoiceId: string): string {
  return `portal/${orderId}/invoices/${killbillInvoiceId}.pdf`;
}
