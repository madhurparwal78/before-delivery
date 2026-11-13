import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { serviceStates, withTimeout } from './state.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const CONTACT_TIMEOUT_MS = 2_500;

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeSegment).join('/');
}

function amzDate(instant: Date): { stamp: string; dateOnly: string } {
  const stamp = instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, dateOnly: stamp.slice(0, 8) };
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function signingKey(dateOnly: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${config.s3SecretAccessKey}`).update(dateOnly).digest();
  const kRegion = createHmac('sha256', kDate).update(config.s3Region).digest();
  const kService = createHmac('sha256', kRegion).update(SERVICE).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

function canonicalQuery(params: [string, string][]): string {
  return params
    .map(([key, value]) => [encodeSegment(key), encodeSegment(value)] as [string, string])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function objectPath(base: URL, key: string): string {
  const prefix = base.pathname.replace(/\/$/, '');
  return config.s3ForcePathStyle
    ? `${prefix}/${config.s3Bucket}/${encodeKey(key)}`
    : `${prefix}/${encodeKey(key)}`;
}

/**
 * A 60-second signed link, signed for the public storage host. Signing needs no
 * network, so a link never implies the object is reachable.
 */
export function signedGetUrl(
  key: string,
  options: { expiresInSeconds: number; contentDisposition?: string; contentType?: string },
): string {
  const base = new URL(config.minioPublicUrl);
  const { stamp, dateOnly } = amzDate(new Date());
  const credential = `${config.s3AccessKeyId}/${dateOnly}/${config.s3Region}/${SERVICE}/aws4_request`;
  const params: [string, string][] = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(options.expiresInSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  if (options.contentDisposition !== undefined) {
    params.push(['response-content-disposition', options.contentDisposition]);
  }
  if (options.contentType !== undefined) {
    params.push(['response-content-type', options.contentType]);
  }
  const path = objectPath(base, key);
  const host = base.host;
  const query = canonicalQuery(params);
  const canonicalRequest = [
    'GET',
    path,
    query,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    ALGORITHM,
    stamp,
    `${dateOnly}/${config.s3Region}/${SERVICE}/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = createHmac('sha256', signingKey(dateOnly)).update(stringToSign).digest('hex');
  return `${base.protocol}//${host}${path}?${query}&X-Amz-Signature=${signature}`;
}

async function signedRequest(
  method: 'PUT' | 'HEAD' | 'GET',
  key: string,
  body: Buffer | null,
  contentType: string | null,
  signal: AbortSignal,
): Promise<Response> {
  const base = new URL(config.s3Endpoint);
  const { stamp, dateOnly } = amzDate(new Date());
  const path = objectPath(base, key);
  const payloadHash = body === null ? sha256Hex('') : sha256Hex(body);
  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (contentType !== null) headers['content-type'] = contentType;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}`).join('\n');
  const canonicalRequest = [
    method,
    path,
    '',
    `${canonicalHeaders}\n`,
    signedHeaderNames.join(';'),
    payloadHash,
  ].join('\n');
  const stringToSign = [
    ALGORITHM,
    stamp,
    `${dateOnly}/${config.s3Region}/${SERVICE}/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = createHmac('sha256', signingKey(dateOnly)).update(stringToSign).digest('hex');
  const authorization =
    `${ALGORITHM} Credential=${config.s3AccessKeyId}/${dateOnly}/${config.s3Region}/${SERVICE}/aws4_request, ` +
    `SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;
  const requestHeaders: Record<string, string> = { ...headers, authorization };
  delete requestHeaders.host;
  return fetch(`${base.protocol}//${base.host}${path}`, {
    method,
    headers: requestHeaders,
    body: body === null ? undefined : new Uint8Array(body),
    signal,
  });
}

export class StorageUnavailable extends Error {}

function failed(): never {
  serviceStates.storage.record(false);
  throw new StorageUnavailable('storage unavailable');
}

/** Writes an object and confirms the write. A record exists only once this has happened. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let response: Response;
  try {
    response = await withTimeout(
      (signal) => signedRequest('PUT', key, body, contentType, signal),
      CONTACT_TIMEOUT_MS,
    );
  } catch {
    failed();
  }
  if (!response.ok) failed();
  await response.arrayBuffer();
  const head = await headObject(key);
  if (head === null) failed();
  serviceStates.storage.record(true);
}

export async function headObject(key: string): Promise<{ size: number } | null> {
  try {
    const response = await withTimeout(
      (signal) => signedRequest('HEAD', key, null, null, signal),
      CONTACT_TIMEOUT_MS,
    );
    if (response.status === 404) {
      serviceStates.storage.record(true);
      return null;
    }
    if (!response.ok) failed();
    serviceStates.storage.record(true);
    return { size: Number(response.headers.get('content-length') ?? '0') };
  } catch (error) {
    if (error instanceof StorageUnavailable) throw error;
    failed();
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const response = await withTimeout(
      (signal) => signedRequest('GET', key, null, null, signal),
      CONTACT_TIMEOUT_MS,
    );
    if (response.status === 404) {
      serviceStates.storage.record(true);
      return null;
    }
    if (!response.ok) failed();
    const bytes = Buffer.from(await response.arrayBuffer());
    serviceStates.storage.record(true);
    return bytes;
  } catch (error) {
    if (error instanceof StorageUnavailable) throw error;
    failed();
  }
}

export async function pingStorage(): Promise<void> {
  try {
    const base = new URL(config.s3Endpoint);
    const response = await withTimeout(
      (signal) =>
        fetch(`${base.protocol}//${base.host}/${config.s3Bucket}?max-keys=0`, {
          method: 'GET',
          headers: { host: base.host },
          signal,
        }),
      CONTACT_TIMEOUT_MS,
    );
    await response.arrayBuffer();
    serviceStates.storage.record(true);
  } catch {
    serviceStates.storage.record(false);
  }
}

export function storageDown(): boolean {
  return serviceStates.storage.down;
}

export function noticePdfKey(copyId: string, number: string, version: number): string {
  return `${copyId}/notices/${number}/v${version}.pdf`;
}

export function sheetKey(copyId: string, sha256: string): string {
  return `${copyId}/sheets/${sha256}`;
}

/**
 * A `Content-Disposition` with an ASCII-only `filename` and an RFC 6266
 * `filename*`, so any stored name downloads with no split header.
 */
export function attachmentDisposition(filename: string): string {
  const ascii = [...filename]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || code > 0x7e || ch === '"' || ch === '\\') return '_';
      return ch;
    })
    .join('');
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16)}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
