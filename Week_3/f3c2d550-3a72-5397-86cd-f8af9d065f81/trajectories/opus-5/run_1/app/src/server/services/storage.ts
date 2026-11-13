import { createHash, createHmac } from 'node:crypto';

/**
 * The object store, reached over the S3 API with the credentials and URL from the
 * environment.
 */

export class StorageUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnreachable';
  }
}

interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function config(): StorageConfig {
  const endpoint = required('S3_ENDPOINT');
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

function sign(
  settings: StorageConfig,
  method: string,
  objectPath: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): SignedRequest {
  const base = new URL(settings.endpoint);
  const canonicalPath = settings.forcePathStyle
    ? `/${settings.bucket}${objectPath ? `/${encodePath(objectPath)}` : ''}`
    : `${objectPath ? `/${encodePath(objectPath)}` : '/'}`;
  const host = settings.forcePathStyle ? base.host : `${settings.bucket}.${base.host}`;
  // Request signing uses the real clock: the object store checks it against its own.
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${headers[name]!.trim()}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [
    method,
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${settings.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${settings.secretAccessKey}`, dateStamp), settings.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `${base.protocol}//${base.host}${canonicalPath}`,
    method,
    headers,
    body: body.length > 0 || method === 'PUT' ? body : undefined,
  };
}

async function send(request: SignedRequest, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      signal: controller.signal,
    });
  } catch (error) {
    throw new StorageUnreachable(`storage request failed: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const settings = config();
  const response = await send(
    sign(settings, 'PUT', key, body, {
      'content-type': contentType,
      'content-length': String(body.length),
    }),
  );
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnreachable(`storage refused PUT ${key}: ${response.status}`);
  }
  await response.arrayBuffer().catch(() => undefined);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const settings = config();
  const response = await send(sign(settings, 'GET', key, Buffer.alloc(0)));
  if (response.status === 404) return null;
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnreachable(`storage refused GET ${key}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const settings = config();
  const response = await send(sign(settings, 'DELETE', key, Buffer.alloc(0)));
  if (!response.ok && response.status !== 404) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnreachable(`storage refused DELETE ${key}: ${response.status}`);
  }
  await response.arrayBuffer().catch(() => undefined);
}

export async function ensureBucket(): Promise<void> {
  const settings = config();
  const head = await send(sign(settings, 'HEAD', '', Buffer.alloc(0)), 5_000);
  await head.arrayBuffer().catch(() => undefined);
  if (head.ok) return;
  if (head.status !== 404) {
    throw new StorageUnreachable(`storage refused HEAD bucket: ${head.status}`);
  }
  const created = await send(sign(settings, 'PUT', '', Buffer.alloc(0)), 5_000);
  await created.arrayBuffer().catch(() => undefined);
  if (!created.ok && created.status !== 409) {
    throw new StorageUnreachable(`storage refused to create the bucket: ${created.status}`);
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    await ensureBucket();
    return true;
  } catch {
    return false;
  }
}

export function originalKey(referenceId: string, extension: string): string {
  return `references/${referenceId}/original.${extension}`;
}

export function displayKey(referenceId: string): string {
  return `references/${referenceId}/display.jpg`;
}

export function sheetKey(sheetId: string): string {
  return `sheets/${sheetId}.pdf`;
}
