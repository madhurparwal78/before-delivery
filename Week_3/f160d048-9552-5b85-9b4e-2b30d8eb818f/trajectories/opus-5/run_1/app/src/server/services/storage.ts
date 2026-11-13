import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

export class StorageUnavailable extends Error {}

const SERVICE = 's3';
const UNSIGNED = 'UNSIGNED-PAYLOAD';

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(
  method: string,
  key: string,
  payload: Buffer | null,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const prefix = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '';
  const path = key === '' ? prefix || '/' : `${prefix}/${key}`;
  const { stamp, date } = amzDate(new Date());
  const payloadHash = payload ? sha256Hex(payload) : UNSIGNED;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name] ?? '').trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    path.split('/').map(encodeURIComponent).join('/'),
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.protocol}//${host}${path}`, headers };
}

async function request(
  method: string,
  key: string,
  payload: Buffer | null,
  extra: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, key, payload, extra);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload ?? undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new StorageUnavailable('storage is unreachable');
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await request('HEAD', '', null);
  if (head.status === 404) {
    const made = await request('PUT', '', Buffer.alloc(0));
    if (!made.ok && made.status !== 409) throw new StorageUnavailable(`bucket create answered ${made.status}`);
  }
}

export async function isAvailable(): Promise<boolean> {
  try {
    const response = await request('HEAD', '', null);
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/** Stores the bytes, then confirms the object exists with the exact stored size. */
export async function putAndConfirm(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const put = await request('PUT', key, bytes, { 'content-type': contentType });
  if (!put.ok) throw new StorageUnavailable(`store answered ${put.status}`);
  const head = await request('HEAD', key, null);
  if (!head.ok) throw new StorageUnavailable(`confirm answered ${head.status}`);
  if (Number(head.headers.get('content-length')) !== bytes.length) {
    throw new StorageUnavailable('stored size does not match');
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await request('GET', key, null);
  if (!response.ok) throw new StorageUnavailable(`read answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function removeObject(key: string): Promise<void> {
  await request('DELETE', key, null);
}

export function resumeKey(fileId: string): string {
  return `resumes/${fileId}.pdf`;
}

export function markKey(companyId: string): string {
  return `marks/${companyId}.png`;
}
