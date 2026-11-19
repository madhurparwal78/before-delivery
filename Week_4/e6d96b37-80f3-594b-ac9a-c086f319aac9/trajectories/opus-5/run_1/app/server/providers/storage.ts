import { createHash, createHmac } from 'node:crypto';
import { limits, providers } from '../config.ts';
import { serviceUnavailable } from '../http/errors.ts';

/**
 * The private object store. Requests are signed with AWS SigV4 directly so the
 * shipped dependency tree stays small. Stored bytes always equal the submitted
 * bytes, and an object counts only once MinIO has confirmed it.
 */

const UNSIGNED = 'UNSIGNED-PAYLOAD';

export function sha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(objectKey: string): string {
  return objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(
  method: string,
  objectKey: string,
  payloadHash: string,
  extraHeaders: Record<string, string>,
  query: string,
): SignedRequest {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = providers.s3;
  const base = new URL(endpoint);
  const encodedKey = objectKey === '' ? '' : `/${encodePath(objectKey)}`;
  const path = forcePathStyle ? `/${bucket}${encodedKey}` : encodedKey || '/';
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;

  const { stamp, date } = amzDate(new Date());
  const headers: Record<string, string> = {
    ...extraHeaders,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };

  const signedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${String(headers[name] ?? headers[name.toLowerCase()]).trim()}\n`)
    .join('');
  const signedHeaders = signedNames.join(';');

  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const urlHost = forcePathStyle ? base.host : host;
  return {
    url: `${base.protocol}//${urlHost}${path}${query ? `?${query}` : ''}`,
    headers,
  };
}

async function call(
  method: string,
  objectKey: string,
  payloadHash: string,
  extraHeaders: Record<string, string>,
  query = '',
  body?: Buffer,
): Promise<Response> {
  const signed = sign(method, objectKey, payloadHash, extraHeaders, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.providerTimeoutMs);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface StoredObject {
  objectKey: string;
  sha256: string;
  size: number;
  contentType: string;
}

/**
 * Writes the bytes, then reads the object's metadata back, so the object only
 * counts after MinIO has confirmed it.
 */
export async function putObject(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<StoredObject> {
  const digest = sha256Hex(body);
  let put: Response;
  try {
    put = await call('PUT', objectKey, digest, { 'content-type': contentType }, '', body);
  } catch {
    throw serviceUnavailable();
  }
  if (!put.ok) {
    await put.arrayBuffer().catch(() => undefined);
    throw serviceUnavailable();
  }
  await put.arrayBuffer().catch(() => undefined);

  const head = await headObject(objectKey);
  if (!head || head.size !== body.length) {
    throw serviceUnavailable();
  }
  return { objectKey, sha256: digest, size: body.length, contentType };
}

export async function headObject(
  objectKey: string,
): Promise<{ size: number; contentType: string } | null> {
  let head: Response;
  try {
    head = await call('HEAD', objectKey, UNSIGNED, {});
  } catch {
    throw serviceUnavailable();
  }
  if (head.status === 404) return null;
  if (!head.ok) throw serviceUnavailable();
  const length = Number.parseInt(head.headers.get('content-length') ?? '', 10);
  return {
    size: Number.isFinite(length) ? length : 0,
    contentType: head.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function getObject(
  objectKey: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  let got: Response;
  try {
    got = await call('GET', objectKey, UNSIGNED, {});
  } catch {
    throw serviceUnavailable();
  }
  if (got.status === 404) return null;
  if (!got.ok) {
    await got.arrayBuffer().catch(() => undefined);
    throw serviceUnavailable();
  }
  const body = Buffer.from(await got.arrayBuffer());
  return {
    body,
    contentType: got.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/** Copies through a read-then-write so the new object is immutable evidence. */
export async function copyObject(
  sourceKey: string,
  targetKey: string,
): Promise<StoredObject | null> {
  const source = await getObject(sourceKey);
  if (!source) return null;
  return putObject(targetKey, source.body, source.contentType);
}

let bucketReady = false;

/** The bucket is created if absent and is never given a public policy. */
export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  let head: Response;
  try {
    head = await call('HEAD', '', UNSIGNED, {});
  } catch {
    throw serviceUnavailable();
  }
  await head.arrayBuffer().catch(() => undefined);
  if (head.status === 404) {
    const made = await call('PUT', '', sha256Hex(''), {}, '', Buffer.alloc(0));
    await made.arrayBuffer().catch(() => undefined);
    if (!made.ok && made.status !== 409) throw serviceUnavailable();
  } else if (!head.ok && head.status !== 403) {
    throw serviceUnavailable();
  }
  bucketReady = true;
}

/* -- published object keys ---------------------------------------------- */

export const objectKeys = {
  specimenPhoto: (ns: string, key: string, label: string, sha: string, ext: string): string =>
    `specimens/${ns}/${key}/${label}-${sha}.${ext}`,
  registerImage: (ns: string, reference: string, revision: number): string =>
    `catalog/${ns}/${reference}/r${revision}.svg`,
  dispatchEvidence: (
    ns: string,
    offer: string,
    party: string,
    key: string,
    sha: string,
    ext: string,
  ): string => `manifests/${ns}/${offer}/${party}/${key}-dispatch-${sha}.${ext}`,
  manifestRecord: (ns: string, offer: string, party: string): string =>
    `manifests/${ns}/${offer}/${party}/manifest.json`,
  arrivalPhoto: (ns: string, offer: string, key: string, sha: string, ext: string): string =>
    `arrivals/${ns}/${offer}/${key}-${sha}.${ext}`,
  disputeSnapshot: (ns: string, dispute: string, sequence: number): string =>
    `disputes/${ns}/${dispute}/evidence-${sequence}.json`,
} as const;
