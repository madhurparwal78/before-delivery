import { createHash, createHmac } from 'node:crypto';
import { config, PROVIDER_TIMEOUT_MS } from './config.js';


/**
 * Storage is unreachable when it can't be reached, refuses a request (any answer
 * but a success, or a 404 for an object), or passes the per-call time limit.
 */
export class StorageDown extends Error {}

function sha256Hex(payload: Uint8Array | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(key: string): string {
  const prefix = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '';
  if (key === '') return `${prefix}/`;
  return `${prefix}/${key.split('/').map(encodeSegment).join('/')}`;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(
  method: string,
  key: string,
  queryParts: ReadonlyArray<[string, string]>,
  payloadHash: string,
  extraHeaders: Record<string, string> = {},
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const host = endpoint.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowered = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${String(lowered.get(name)).trim()}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalQuery = [...queryParts]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const path = canonicalPath(key);
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpoint.origin}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  return { url, headers };
}

async function call(
  method: string,
  key: string,
  queryParts: ReadonlyArray<[string, string]>,
  body: Uint8Array | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const payloadHash = body ? sha256Hex(body) : sha256Hex('');
  const signed = sign(method, key, queryParts, payloadHash, extraHeaders);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body ? Buffer.from(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new StorageDown('storage unreachable');
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const response = await call('PUT', key, [], bytes, {
    'content-type': contentType,
    'content-length': String(bytes.byteLength),
  });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageDown('storage refused the write');
  }
  await response.arrayBuffer().catch(() => undefined);
}

export async function getObject(key: string): Promise<Uint8Array> {
  const response = await call('GET', key, [], null);
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageDown('storage refused the read');
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function headObjectSize(key: string): Promise<number> {
  const response = await call('HEAD', key, [], null);
  if (!response.ok) throw new StorageDown('storage refused the metadata read');
  const length = response.headers.get('content-length');
  if (length === null) throw new StorageDown('storage returned no size');
  return Number(length);
}

export async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const queryParts: Array<[string, string]> = [
      ['list-type', '2'],
      ['prefix', prefix],
      ['max-keys', '1000'],
    ];
    if (token) queryParts.push(['continuation-token', token]);
    const response = await call('GET', '', queryParts, null);
    if (!response.ok) throw new StorageDown('storage refused the listing');
    const text = await response.text();
    for (const match of text.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      const raw = match[1];
      if (raw !== undefined) keys.push(decodeXmlText(raw));
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(text);
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(text);
    token = truncated && next?.[1] ? decodeXmlText(next[1]) : null;
  } while (token);
  return keys;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call('DELETE', key, [], null);
  if (!response.ok && response.status !== 204 && response.status !== 404) {
    throw new StorageDown('storage refused the delete');
  }
  await response.arrayBuffer().catch(() => undefined);
}

export async function deletePrefix(prefix: string): Promise<void> {
  for (const key of await listObjects(prefix)) {
    await deleteObject(key);
  }
}

export async function ensureBucket(): Promise<void> {
  const response = await call('HEAD', '', [], null);
  if (response.ok) return;
  const created = await call('PUT', '', [], new Uint8Array(0));
  if (!created.ok && created.status !== 409) {
    throw new StorageDown('storage refused to create the bucket');
  }
  await created.arrayBuffer().catch(() => undefined);
}

export function strokesKey(accountId: string, observationId: string, sha256: string): string {
  return `observers/${accountId}/strokes/${observationId}/${sha256}.json`;
}

export function rasterKey(accountId: string, observationId: string, sha256: string): string {
  return `observers/${accountId}/rasters/${observationId}/${sha256}.png`;
}

export function packetPrefix(accountId: string, packetId: string): string {
  return `observers/${accountId}/packets/${packetId}/`;
}

export function packetPdfKey(accountId: string, packetId: string, sha256: string): string {
  return `${packetPrefix(accountId, packetId)}${sha256}.pdf`;
}

export function observationSketchPrefixes(accountId: string, observationId: string): string[] {
  return [
    `observers/${accountId}/strokes/${observationId}/`,
    `observers/${accountId}/rasters/${observationId}/`,
  ];
}
