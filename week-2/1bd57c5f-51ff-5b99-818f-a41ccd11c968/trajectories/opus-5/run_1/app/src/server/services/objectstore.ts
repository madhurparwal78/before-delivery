import { createHash, createHmac } from 'node:crypto';
import { config } from '../env.js';

export class StorageUnavailable extends Error {}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

type Method = 'GET' | 'PUT' | 'DELETE' | 'HEAD' | 'POST';

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function uriEncode(value: string, encodeSlash: boolean): string {
  let out = '';
  for (const ch of value) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === '/') out += encodeSlash ? '%2F' : '/';
    else {
      for (const byte of Buffer.from(ch, 'utf8')) {
        out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}

type SignedRequest = {
  url: string;
  headers: Record<string, string>;
};

function signRequest(
  method: Method,
  objectPath: string,
  query: Record<string, string>,
  payload: Buffer | null,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalPath = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${objectPath}`
    : objectPath;
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = payload === null ? EMPTY_SHA256 : sha256Hex(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (payload !== null) headers['content-length'] = String(payload.length);

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames.map((n) => `${n}:${headers[n].trim()}\n`).join('');
  const signedHeaders = sortedHeaderNames.join(';');
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k, true)}=${uriEncode(query[k], true)}`)
    .join('&');
  const canonicalRequest = [
    method,
    uriEncode(canonicalPath, false),
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

  const url = `${endpoint.protocol}//${host}${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  return { url, headers };
}

async function send(
  method: Method,
  objectPath: string,
  query: Record<string, string>,
  payload: Buffer | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, objectPath, query, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(signed.url, {
      method,
      headers: { ...signed.headers, ...extraHeaders },
      body: payload === null ? undefined : new Uint8Array(payload),
      signal: controller.signal,
    });
  } catch (error) {
    throw new StorageUnavailable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

function keyPath(key: string): string {
  return `/${key}`;
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '/', {}, null);
  if (head.status === 404) {
    const made = await send('PUT', '/', {}, Buffer.alloc(0));
    if (!made.ok && made.status !== 409) {
      throw new StorageUnavailable(`bucket create failed: ${made.status}`);
    }
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', keyPath(key), {}, body, { 'content-type': contentType });
  if (!response.ok) throw new StorageUnavailable(`put ${key}: ${response.status}`);
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', keyPath(key), {}, null);
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageUnavailable(`head ${key}: ${response.status}`);
  return true;
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', keyPath(key), {}, null);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`get ${key}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', keyPath(key), {}, null);
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(`delete ${key}: ${response.status}`);
  }
}

export async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { 'list-type': '2', prefix };
    if (token) query['continuation-token'] = token;
    const response = await send('GET', '/', query, null);
    if (!response.ok) throw new StorageUnavailable(`list ${prefix}: ${response.status}`);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push(decodeXml(match[1]));
    }
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    token = next ? decodeXml(next[1]) : undefined;
  } while (token);
  return keys;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export async function deletePrefix(prefix: string): Promise<void> {
  const keys = await listObjects(prefix);
  for (const key of keys) await deleteObject(key);
}
