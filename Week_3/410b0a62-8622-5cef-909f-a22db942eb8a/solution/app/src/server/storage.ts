import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { StorageFailure } from './errors.js';

const EMPTY_PAYLOAD_HASH = createHash('sha256').update('').digest('hex');

const sha256Hex = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

interface Call {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  key?: string;
  query?: Record<string, string>;
  body?: Uint8Array;
  headers?: Record<string, string>;
}

async function send(call: Call): Promise<Response> {
  const { endpoint, bucket, forcePathStyle, region, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const objectPath = call.key ? `/${call.key.split('/').map(encodeSegment).join('/')}` : '';
  const path = `${forcePathStyle ? `/${bucket}` : ''}${objectPath}` || '/';
  const query = Object.entries(call.query ?? {})
    .map(([name, value]) => [encodeSegment(name), encodeSegment(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');

  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payloadHash = call.body ? sha256Hex(call.body) : EMPTY_PAYLOAD_HASH;
  const signed: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...Object.fromEntries(Object.entries(call.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
  };
  const names = Object.keys(signed).sort();
  const canonical = [
    call.method,
    path,
    query,
    ...names.map((name) => `${name}:${(signed[name] ?? '').trim()}`),
    '',
    names.join(';'),
    payloadHash
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const signingKey = [day, region, 's3', 'aws4_request'].reduce<Buffer | string>((key, part) => hmac(key, part), `AWS4${secretAccessKey}`);
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');

  const headers = new Headers();
  for (const [name, value] of Object.entries(signed)) if (name !== 'host') headers.set(name, value);
  headers.set('authorization', `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`);

  const origin = forcePathStyle ? base.origin : `${base.protocol}//${host}`;
  try {
    const init: RequestInit = { method: call.method, headers, signal: AbortSignal.timeout(config.uploadTimeoutMs) };
    if (call.body) init.body = Buffer.from(call.body);
    return await fetch(`${origin}${path}${query ? `?${query}` : ''}`, init);
  } catch {
    throw new StorageFailure('object storage did not answer');
  }
}

const expect = (response: Response, ...statuses: number[]): Response => {
  if (!statuses.includes(response.status)) throw new StorageFailure(`object storage answered ${response.status}`);
  return response;
};

let bucketReady = false;

/** Asks storage about the bucket now and creates it when it is missing. Throws StorageFailure when storage cannot be reached. */
export async function checkBucket(): Promise<void> {
  const head = await send({ method: 'HEAD' });
  if (head.status === 404) expect(await send({ method: 'PUT' }), 200, 409);
  else expect(head, 200);
  bucketReady = true;
}

/** Makes sure the bucket exists before a write; asks storage only until it has answered once. */
export async function ensureBucket(): Promise<void> {
  if (!bucketReady) await checkBucket();
}

interface StoredObject {
  size: number;
  sha256: string | null;
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string, metadata: { sha256: string; filename: string }): Promise<void> {
  await ensureBucket();
  expect(
    await send({
      method: 'PUT',
      key,
      body: bytes,
      headers: {
        'content-type': contentType,
        'x-amz-meta-sha256': metadata.sha256,
        'x-amz-meta-filename': encodeURIComponent(metadata.filename)
      }
    }),
    200
  );
}

export async function headObject(key: string): Promise<StoredObject> {
  const response = expect(await send({ method: 'HEAD', key }), 200);
  return { size: Number(response.headers.get('content-length')), sha256: response.headers.get('x-amz-meta-sha256') };
}

export async function getObject(key: string): Promise<Buffer> {
  const response = expect(await send({ method: 'GET', key }), 200);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  expect(await send({ method: 'DELETE', key }), 200, 204);
}

export async function deletePrefix(prefix: string): Promise<void> {
  for (;;) {
    const listing = expect(await send({ method: 'GET', query: { 'list-type': '2', prefix } }), 200);
    const keys = [...(await listing.text()).matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) =>
      (match[1] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    );
    if (keys.length === 0) return;
    for (const key of keys) await deleteObject(key);
  }
}
