/**
 * The MinIO client: single-part writes, HEAD checks and byte-for-byte reads,
 * signed with AWS Signature Version 4. The browser never talks to storage.
 */

import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from '../config';

export class StorageUnavailable extends Error {}

export interface ObjectHead {
  size: number;
  etag: string;
  contentType: string;
}

export interface ObjectBody extends ObjectHead {
  stream: Readable;
}

const SERVICE = 's3';

function hash(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

function objectUrl(key: string | null): { url: URL; canonicalUri: string } {
  const base = new URL(config.s3.endpoint);
  const bucketPath = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${key === null ? '' : `/${key}`}`
    : `/${key ?? ''}`;
  const url = new URL(base.origin + encodePath(bucketPath));
  if (!config.s3.forcePathStyle) url.hostname = `${config.s3.bucket}.${base.hostname}`;
  return { url, canonicalUri: url.pathname };
}

interface SignedRequest {
  method: string;
  key: string | null;
  body?: Buffer;
  contentType?: string;
}

/**
 * Storage signatures use wall-clock time: MinIO rejects a signature whose date
 * is far from its own, so this is not an app-clock domain decision.
 */
function amzDate(): { amz: string; day: string } {
  const iso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amz: iso, day: iso.slice(0, 8) };
}

async function send(request: SignedRequest): Promise<Response> {
  const { url, canonicalUri } = objectUrl(request.key);
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = hash(body);
  const { amz, day } = amzDate();
  const headers = new Map<string, string>([
    ['host', url.host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amz],
  ]);
  if (request.contentType) headers.set('content-type', request.contentType);

  const signedHeaders = [...headers.keys()].sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers.get(name)}\n`).join('');
  const canonicalRequest = [
    request.method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const outgoing: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  };
  if (request.contentType) outgoing['content-type'] = request.contentType;

  try {
    return await fetch(url, {
      method: request.method,
      headers: outgoing,
      body: request.method === 'PUT' || request.method === 'POST' ? body : undefined,
    });
  } catch {
    throw new StorageUnavailable('object store unreachable');
  }
}

function etagOf(response: Response): string {
  return (response.headers.get('etag') ?? '').replace(/"/g, '');
}

export async function ensureBucket(): Promise<void> {
  const response = await send({ method: 'HEAD', key: null });
  if (response.ok) return;
  const created = await send({ method: 'PUT', key: null });
  await created.text().catch(() => undefined);
  if (!created.ok && created.status !== 409) {
    throw new StorageUnavailable(`could not create bucket (${created.status})`);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<ObjectHead> {
  const response = await send({ method: 'PUT', key, body, contentType });
  const etag = etagOf(response);
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok) throw new StorageUnavailable(`put ${key} failed (${response.status})`);
  return { size: body.length, etag, contentType };
}

export async function headObject(key: string): Promise<ObjectHead | null> {
  const response = await send({ method: 'HEAD', key });
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`head ${key} failed (${response.status})`);
  return {
    size: Number(response.headers.get('content-length') ?? '0'),
    etag: etagOf(response),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function getObject(key: string): Promise<ObjectBody | null> {
  const response = await send({ method: 'GET', key });
  if (response.status === 404) {
    await response.text().catch(() => undefined);
    return null;
  }
  if (!response.ok || !response.body) {
    await response.text().catch(() => undefined);
    throw new StorageUnavailable(`get ${key} failed (${response.status})`);
  }
  return {
    size: Number(response.headers.get('content-length') ?? '0'),
    etag: etagOf(response),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    stream: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
  };
}

/** Writes an object only when nothing is stored under that key yet. */
export async function putIfAbsent(key: string, body: Buffer, contentType: string): Promise<ObjectHead> {
  const existing = await headObject(key);
  if (existing) return existing;
  return putObject(key, body, contentType);
}
