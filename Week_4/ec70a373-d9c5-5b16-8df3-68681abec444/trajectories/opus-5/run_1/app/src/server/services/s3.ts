import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

export class StorageUnavailable extends Error {
  constructor(detail: string) {
    super(`storage unavailable: ${detail}`);
    this.name = 'StorageUnavailable';
  }
}

const REQUEST_TIMEOUT_MS = 5000;

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function amzDate(nowMs: number): { stamp: string; date: string } {
  const iso = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp: iso, date: iso.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  key: string,
  body: Buffer,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const encodedKey = key.split('/').map(encodeSegment).join('/');
  const canonicalPath = config.s3.forcePathStyle
    ? `/${encodeSegment(config.s3.bucket)}/${encodedKey}`
    : `/${encodedKey}`;
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;
  const payloadHash = sha256Hex(body);
  const { stamp, date } = amzDate(Date.now());
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => {
      const entry = Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === name);
      const value = entry === undefined ? '' : String(entry[1]).trim();
      return `${name}:${value}\n`;
    })
    .join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const base = config.s3.forcePathStyle
    ? `${endpoint.protocol}//${endpoint.host}`
    : `${endpoint.protocol}//${host}`;
  return { url: `${base}${canonicalPath}`, headers };
}

async function send(
  method: string,
  key: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, key, body, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable(`${method} failed`);
  }
}

export interface ObjectHead {
  contentLength: number;
  contentType: string;
  metadata: Record<string, string>;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  metadata: Record<string, string>,
): Promise<void> {
  const extra: Record<string, string> = { 'content-type': contentType };
  for (const [name, value] of Object.entries(metadata)) {
    extra[`x-amz-meta-${name}`] = value;
  }
  const response = await send('PUT', key, body, extra);
  if (!response.ok) throw new StorageUnavailable(`put ${response.status}`);
}

export async function headObject(key: string): Promise<ObjectHead> {
  const response = await send('HEAD', key, Buffer.alloc(0));
  if (!response.ok) throw new StorageUnavailable(`head ${response.status}`);
  const metadata: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('x-amz-meta-')) metadata[lower.slice('x-amz-meta-'.length)] = value;
  });
  return {
    contentLength: Number(response.headers.get('content-length') ?? '-1'),
    contentType: response.headers.get('content-type') ?? '',
    metadata,
  };
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send('GET', key, Buffer.alloc(0));
  if (!response.ok) throw new StorageUnavailable(`get ${response.status}`);
  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key, Buffer.alloc(0));
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(`delete ${response.status}`);
  }
}
