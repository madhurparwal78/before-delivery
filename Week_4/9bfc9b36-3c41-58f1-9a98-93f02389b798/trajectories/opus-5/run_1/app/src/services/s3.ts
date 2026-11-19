import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

/**
 * A small S3 client for MinIO, signing with Signature Version 4.
 * The browser never receives a store address: the server streams every object.
 */

export interface StoredObject {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export class StoreUnreachable extends Error {
  constructor(cause: string) {
    super(`The cut-sheet store did not answer: ${cause}`);
    this.name = 'StoreUnreachable';
  }
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(segments: readonly string[]): string {
  return segments.map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

interface SignedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: Buffer;
}

function signRequest(
  method: string,
  canonicalUri: string,
  host: string,
  origin: string,
  body: Buffer,
  extraHeaders: Readonly<Record<string, string>>,
): SignedRequest {
  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${(headers[name] as string).trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${config.s3Region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3SecretAccessKey}`, date), config.s3Region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const request: SignedRequest = { method, url: `${origin}${canonicalUri}`, headers };
  return body.length > 0 ? { ...request, body } : request;
}

const STORE_TIMEOUT_MS = 4000;

async function send(request: SignedRequest): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORE_TIMEOUT_MS);
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
  } catch (cause) {
    throw new StoreUnreachable(cause instanceof Error ? cause.message : 'unknown');
  } finally {
    clearTimeout(timer);
  }
}

function endpointParts(): { origin: string; host: string; prefix: string } {
  const url = new URL(config.s3Endpoint);
  const host = url.host;
  const origin = `${url.protocol}//${url.host}`;
  const prefix = config.s3ForcePathStyle ? `/${encodeURIComponent(config.s3Bucket)}` : '';
  return { origin, host, prefix };
}

function objectUri(key: string): { origin: string; host: string; uri: string } {
  const { origin, host, prefix } = endpointParts();
  return { origin, host, uri: `${prefix}/${encodePath(key.split('/'))}` };
}

export async function ensureBucket(): Promise<void> {
  const { origin, host, prefix } = endpointParts();
  const head = signRequest('HEAD', prefix === '' ? '/' : prefix, host, origin, Buffer.alloc(0), {});
  const existing = await send(head);
  if (existing.status === 200 || existing.status === 403) return;
  const create = signRequest('PUT', prefix === '' ? '/' : prefix, host, origin, Buffer.alloc(0), {});
  const made = await send(create);
  if (made.status >= 200 && made.status < 300) return;
  if (made.status === 409) return; // another instance made it first
  throw new StoreUnreachable(`bucket create answered ${made.status}`);
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
  metadata: Readonly<Record<string, string>>,
): Promise<void> {
  const { origin, host, uri } = objectUri(key);
  const extra: Record<string, string> = { 'content-type': contentType };
  for (const [name, value] of Object.entries(metadata)) extra[`x-amz-meta-${name}`] = value;
  const response = await send(signRequest('PUT', uri, host, origin, bytes, extra));
  if (response.status < 200 || response.status >= 300) {
    throw new StoreUnreachable(`put answered ${response.status}`);
  }
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const { origin, host, uri } = objectUri(key);
  const response = await send(signRequest('GET', uri, host, origin, Buffer.alloc(0), {}));
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (response.status < 200 || response.status >= 300) {
    await response.arrayBuffer();
    throw new StoreUnreachable(`get answered ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const metadata: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith('x-amz-meta-')) metadata[name.toLowerCase().slice('x-amz-meta-'.length)] = value;
  });
  return {
    bytes,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    metadata,
  };
}

export function sha256OfBytes(bytes: Buffer): string {
  return sha256Hex(bytes);
}
