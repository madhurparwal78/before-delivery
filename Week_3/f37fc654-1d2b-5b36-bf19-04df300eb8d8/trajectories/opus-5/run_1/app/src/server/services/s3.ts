import { createHash, createHmac } from 'node:crypto';
import { env } from '../env.js';

/**
 * MinIO access over the S3 REST API with SigV4 request signing. Bytes are
 * stored exactly as received or rendered.
 */

export class StorageUnavailable extends Error {}

const SERVICE = 's3';
const UNSIGNED_SAFE = /[^A-Za-z0-9\-._~/]/g;

function encodeKey(key: string): string {
  return key.replace(UNSIGNED_SAFE, (c) =>
    Array.from(Buffer.from(c, 'utf8'))
      .map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`)
      .join(''),
  );
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  key: string,
  body: Buffer | null,
  extraHeaders: Record<string, string>,
  canonicalQuery = '',
): SignedRequest {
  const endpoint = new URL(env.s3Endpoint);
  const suffix = key === '' ? '' : `/${encodeKey(key)}`;
  const path = env.s3ForcePathStyle ? `/${env.s3Bucket}${suffix}` : suffix === '' ? '/' : suffix;
  const host = env.s3ForcePathStyle
    ? endpoint.host
    : `${env.s3Bucket}.${endpoint.host}`;

  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const { stamp, date } = amzDate(new Date());

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };

  const signedNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = signedNames
    .map((name) => {
      const match = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
      return `${name}:${String(match?.[1] ?? '').trim()}\n`;
    })
    .join('');
  const signedHeaders = signedNames.join(';');

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${env.s3Region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${env.s3SecretAccessKey}`, date), env.s3Region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${env.s3AccessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const search = canonicalQuery === '' ? '' : `?${canonicalQuery}`;
  return { url: `${endpoint.protocol}//${host}${path}${search}`, headers };
}

async function send(
  method: string,
  key: string,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 15_000,
  canonicalQuery = '',
): Promise<Response> {
  const signed = signRequest(method, key, body, extraHeaders, canonicalQuery);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body ?? undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new StorageUnavailable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Write the exact bytes and confirm the stored object's size, so a file counts
 * as stored only once the file store has acknowledged it.
 */
export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<StoredObject> {
  const res = await send('PUT', key, bytes, {
    'content-type': contentType,
    'content-length': String(bytes.length),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new StorageUnavailable(`put ${res.status} ${text.slice(0, 200)}`);
  }
  await res.arrayBuffer().catch(() => undefined);

  const head = await send('HEAD', key, null);
  if (!head.ok) throw new StorageUnavailable(`head ${head.status}`);
  const storedSize = Number.parseInt(head.headers.get('content-length') ?? '-1', 10);
  if (storedSize !== bytes.length) {
    throw new StorageUnavailable(`stored size ${storedSize} does not match ${bytes.length}`);
  }
  return { key, sizeBytes: bytes.length, sha256: sha256Hex(bytes) };
}

export interface FetchedObject {
  bytes: Buffer;
  contentType: string;
}

export async function getObject(key: string): Promise<FetchedObject> {
  const res = await send('GET', key, null);
  if (!res.ok) throw new StorageUnavailable(`get ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    bytes,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/** Create the bucket when it is absent, so storage is ready on first use. */
export async function ensureBucket(): Promise<void> {
  const probe = await send('HEAD', '', null);
  if (probe.ok) return;
  const created = await send('PUT', '', null);
  if (!created.ok) {
    const text = await created.text().catch(() => '');
    if (!text.includes('BucketAlreadyOwnedByYou')) {
      throw new StorageUnavailable(`create bucket ${created.status}`);
    }
  }
}

export async function storageIsUp(): Promise<boolean> {
  try {
    const res = await send('HEAD', '', null, {}, 3_000);
    return res.ok;
  } catch {
    return false;
  }
}

export const objectKeys = {
  file: (commissionId: string, fileId: string) => `commissions/${commissionId}/files/${fileId}`,
  render: (commissionId: string, renderId: string) =>
    `commissions/${commissionId}/renders/${renderId}.png`,
  contract: (commissionId: string, version: number) =>
    `commissions/${commissionId}/documents/contract-v${version}.pdf`,
  invoice: (commissionId: string, killbillInvoiceId: string) =>
    `commissions/${commissionId}/documents/invoice-${killbillInvoiceId}.pdf`,
};
