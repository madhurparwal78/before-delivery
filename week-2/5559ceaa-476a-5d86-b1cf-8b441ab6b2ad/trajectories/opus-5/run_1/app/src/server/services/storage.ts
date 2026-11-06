import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { config } from '../config.js';

const REQUEST_TIMEOUT_MS = 2000;
const BREAKER_MS = 1000;
const SERVICE = 's3';

export class StorageUnreachable extends Error {
  constructor(cause: string) {
    super(`Object storage is unreachable: ${cause}`);
    this.name = 'StorageUnreachable';
  }
}

export interface StoredObject {
  body: Buffer;
  checksumSha256: string | null;
}

interface S3Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Base64(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('base64');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function signedUrl(key: string): { url: URL; canonicalPath: string } {
  const base = new URL(config.s3.endpoint);
  const keyPath = key.split('/').map(encodePathSegment).join('/');
  const canonicalPath = config.s3.forcePathStyle
    ? `/${encodePathSegment(config.s3.bucket)}/${keyPath}`
    : `/${keyPath}`;
  const url = new URL(base.toString());
  if (!config.s3.forcePathStyle) url.host = `${config.s3.bucket}.${base.host}`;
  url.pathname = canonicalPath;
  return { url, canonicalPath };
}

/**
 * Once storage has just refused a connection, further calls fail at once for a
 * moment so a single request does not pay one timeout per object.
 */
let unreachableUntil = 0;

function send(
  method: string,
  key: string,
  query: Record<string, string>,
  body: Buffer,
  extraHeaders: Record<string, string>,
): Promise<S3Response> {
  if (Date.now() < unreachableUntil) {
    return Promise.reject(new StorageUnreachable('recently unreachable'));
  }
  const { url, canonicalPath } = signedUrl(key);
  const sortedQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name] ?? '')}`)
    .join('&');
  url.search = sortedQuery;

  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    ...extraHeaders,
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (body.length > 0 || method === 'PUT' || method === 'POST') {
    headers['content-length'] = String(body.length);
  }

  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames
    .map((name) => `${name}:${(headers[name] ?? '').trim()}\n`)
    .join('');
  const signedHeaders = headerNames.join(';');

  const canonicalRequest = [
    method,
    canonicalPath,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise<S3Response>((resolvePromise, rejectPromise) => {
    const req = transport(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port === '' ? undefined : Number(url.port),
        method,
        path: `${url.pathname}${sortedQuery === '' ? '' : `?${sortedQuery}`}`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolvePromise({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', (cause) => rejectPromise(new StorageUnreachable(cause.message)));
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    req.on('error', (cause) => {
      unreachableUntil = Date.now() + BREAKER_MS;
      rejectPromise(new StorageUnreachable(cause.message));
    });
    req.end(body);
  });
}

function headerValue(res: S3Response, name: string): string | null {
  const value = res.headers[name];
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function assertOk(res: S3Response): void {
  if (res.status >= 500) throw new StorageUnreachable(`status ${res.status}`);
  if (res.status >= 400) throw new StorageUnreachable(`status ${res.status}: ${res.body.toString('utf8')}`);
}

export async function putObject(
  key: string,
  body: Buffer,
  options: { checksumSha256?: string; contentType: string },
): Promise<void> {
  const headers: Record<string, string> = { 'content-type': options.contentType };
  if (options.checksumSha256 !== undefined) {
    headers['x-amz-checksum-sha256'] = options.checksumSha256;
  }
  const res = await send('PUT', key, {}, body, headers);
  assertOk(res);
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const res = await send('GET', key, {}, Buffer.alloc(0), {});
  if (res.status === 404) return null;
  assertOk(res);
  return { body: res.body, checksumSha256: headerValue(res, 'x-amz-checksum-sha256') };
}

export async function headObject(key: string): Promise<{ checksumSha256: string | null } | null> {
  const res = await send('HEAD', key, {}, Buffer.alloc(0), { 'x-amz-checksum-mode': 'ENABLED' });
  if (res.status === 404) return null;
  assertOk(res);
  return { checksumSha256: headerValue(res, 'x-amz-checksum-sha256') };
}

export async function deleteObject(key: string): Promise<void> {
  const res = await send('DELETE', key, {}, Buffer.alloc(0), {});
  if (res.status === 404) return;
  assertOk(res);
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' };
    if (token !== undefined) query['continuation-token'] = token;
    const res = await send('GET', '', query, Buffer.alloc(0), {});
    assertOk(res);
    const xml = res.body.toString('utf8');
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      const raw = match[1];
      if (raw !== undefined) keys.push(decodeXml(raw));
    }
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    token = next?.[1] === undefined ? undefined : decodeXml(next[1]);
  } while (token !== undefined);
  return keys;
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** Confirms storage answers, throwing StorageUnreachable when it does not. */
export async function probeStorage(): Promise<void> {
  await headObject('reachability-probe');
}

export async function ensureBucket(): Promise<void> {
  const res = await send('PUT', '', {}, Buffer.alloc(0), {});
  if (res.status === 409 || res.status === 200) return;
  assertOk(res);
}
