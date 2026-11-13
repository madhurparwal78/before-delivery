import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

export class StorageUnavailable extends Error {}

const STORAGE_TIMEOUT_MS = 10_000;

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

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, key: string, payload: Buffer, extraHeaders: Record<string, string> = {}): SignedRequest {
  const endpoint = new URL(config.s3Endpoint);
  const path = config.s3ForcePathStyle
    ? `/${config.s3Bucket}${key === '' ? '' : `/${encodeKey(key)}`}`
    : `/${encodeKey(key)}`;
  const host = config.s3ForcePathStyle ? endpoint.host : `${config.s3Bucket}.${endpoint.host}`;
  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${(headers[name] as string).trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${config.s3Region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3SecretAccessKey}`, date), config.s3Region), 's3'), 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const base = config.s3Endpoint.replace(/\/+$/, '');
  return { url: `${base}${path}`, headers };
}

async function call(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Buffer }> {
  const signed = sign(method, key, payload, extraHeaders);
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : payload,
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable('storage unreachable');
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (response.status >= 500) throw new StorageUnavailable(`storage answered ${response.status}`);
  return { status: response.status, body };
}

/** The bucket is created on first need, so a copy with its own empty bucket serves without a seed step. */
export async function ensureBucket(): Promise<void> {
  if ((await call('HEAD', '', Buffer.alloc(0))).status === 200) return;
  const made = await call('PUT', '', Buffer.alloc(0));
  if (made.status >= 300 && made.status !== 409) throw new StorageUnavailable(`storage refused a bucket: ${made.status}`);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let result = await call('PUT', key, body, { 'content-type': contentType });
  if (result.status === 404) {
    await ensureBucket();
    result = await call('PUT', key, body, { 'content-type': contentType });
  }
  if (result.status >= 300) throw new StorageUnavailable(`storage refused a write: ${result.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const result = await call('GET', key, Buffer.alloc(0));
  if (result.status === 404) return null;
  if (result.status >= 300) throw new StorageUnavailable(`storage refused a read: ${result.status}`);
  return result.body;
}

export async function deleteObject(key: string): Promise<void> {
  const result = await call('DELETE', key, Buffer.alloc(0));
  if (result.status >= 300 && result.status !== 404) {
    throw new StorageUnavailable(`storage refused a delete: ${result.status}`);
  }
}

/** An object counts as stored only once it is read back with matching size and digest. */
export async function putAndVerify(key: string, body: Buffer, contentType: string): Promise<string> {
  await putObject(key, body, contentType);
  const readBack = await getObject(key);
  const digest = sha256Hex(body);
  if (!readBack || readBack.length !== body.length || sha256Hex(readBack) !== digest) {
    throw new StorageUnavailable('stored copy did not match');
  }
  return digest;
}

export function receiptKey(householdId: string, receiptId: string): string {
  return `households/${householdId}/receipts/${receiptId}`;
}

export function recordKey(householdId: string, recordId: string): string {
  return `households/${householdId}/records/${recordId}.pdf`;
}
