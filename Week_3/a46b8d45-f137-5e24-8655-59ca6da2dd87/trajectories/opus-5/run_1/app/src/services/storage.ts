/**
 * MinIO holds the damage photos and the dispatch notes. The browser never talks to MinIO,
 * so every object moves through here, and no storage key ever reaches a page or a response.
 *
 * Requests are signed with AWS Signature Version 4, which is all MinIO asks for.
 */

import { createHash, createHmac } from 'node:crypto';

import { config } from '../config';
import { StorageUnavailable } from './outages';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 8000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** RFC 3986 encoding, which S3 wants for each path segment and query value. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKeyPath(key: string): string {
  return key.split('/').map(uriEncode).join('/');
}

interface SignedRequest {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  key?: string;
  query?: Record<string, string>;
  body?: Buffer;
  contentType?: string;
}

function buildRequest(request: SignedRequest): { url: string; headers: Record<string, string> } {
  const endpoint = new URL(config.s3.endpoint);
  const keyPath = request.key === undefined ? '' : `/${encodeKeyPath(request.key)}`;
  // MinIO is addressed path style, so the bucket is the first path segment.
  const canonicalPath = config.s3.forcePathStyle
    ? `/${uriEncode(config.s3.bucket)}${keyPath}`
    : keyPath === ''
      ? '/'
      : keyPath;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;

  const queryEntries = Object.entries(request.query ?? {}).sort(([left], [right]) => (left < right ? -1 : 1));
  const canonicalQuery = queryEntries.map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`).join('&');

  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = stamp.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (request.contentType !== undefined) headers['content-type'] = request.contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [
    request.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${day}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers['authorization'] =
    `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpoint.protocol}//${config.s3.forcePathStyle ? endpoint.host : host}${canonicalPath}${canonicalQuery === '' ? '' : `?${canonicalQuery}`}`;
  return { url, headers };
}

async function send(request: SignedRequest): Promise<Response> {
  const { url, headers } = buildRequest(request);
  try {
    return await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'PUT' ? (request.body ?? Buffer.alloc(0)) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

/** A 5xx from MinIO is an outage; anything else is an answer the caller judges. */
function refuseOnServerError(response: Response): Response {
  if (response.status >= 500) throw new StorageUnavailable(new Error(`storage answered ${response.status}`));
  return response;
}

export async function ensureBucket(): Promise<void> {
  const head = refuseOnServerError(await send({ method: 'HEAD' }));
  if (head.ok) return;
  const created = await send({ method: 'PUT' });
  // Another copy may have created it between the two calls.
  if (!created.ok && created.status !== 409) refuseOnServerError(created);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const response = refuseOnServerError(await send({ method: 'PUT', key, body, contentType }));
  if (!response.ok) throw new StorageUnavailable(new Error(`storage refused PUT ${response.status}`));
}

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const response = refuseOnServerError(await send({ method: 'GET', key }));
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(new Error(`storage refused GET ${response.status}`));
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function deleteObject(key: string): Promise<void> {
  const response = refuseOnServerError(await send({ method: 'DELETE', key }));
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(new Error(`storage refused DELETE ${response.status}`));
  }
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { 'list-type': '2', prefix };
    if (token !== undefined) query['continuation-token'] = token;
    const response = refuseOnServerError(await send({ method: 'GET', query }));
    if (!response.ok) throw new StorageUnavailable(new Error(`storage refused LIST ${response.status}`));
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push(decodeXmlText(match[1] ?? ''));
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    token = truncated ? (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? undefined) : undefined;
  } while (token !== undefined);
  return keys;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Photos and dispatch notes both sit under one prefix per claim, so erasure clears it. */
export function claimPrefix(reference: string): string {
  return `claims/${reference}/`;
}

export function photoKey(reference: string, index: number): string {
  return `${claimPrefix(reference)}photos/${index}`;
}

export function dispatchNoteKey(reference: string): string {
  return `${claimPrefix(reference)}dispatch-note.html`;
}
