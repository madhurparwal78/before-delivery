import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const SERVICE = 's3';

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzStamp(at: Date): { date: string; dateTime: string } {
  const iso = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { date: iso.slice(0, 8), dateTime: iso };
}

function encodePath(objectKey: string): string {
  return objectKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(
  method: string,
  objectKey: string,
  body: Buffer,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${objectKey ? `/${encodePath(objectKey)}` : ''}`
    : `/${encodePath(objectKey)}`;
  if (!config.s3.forcePathStyle) endpoint.host = `${config.s3.bucket}.${endpoint.host}`;

  const { date, dateTime } = amzStamp(new Date());
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { host: endpoint.host };
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers[name.toLowerCase()] = value;
  }
  headers['x-amz-content-sha256'] = payloadHash;
  headers['x-amz-date'] = dateTime;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]?.trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateTime,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${endpoint.origin}${path}`, headers };
}

async function send(
  method: string,
  objectKey: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, objectKey, body, extraHeaders);
  return fetch(signed.url, {
    method,
    headers: signed.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
}

export class StorageDown extends Error {
  constructor(detail: string) {
    super(`Object storage is unavailable: ${detail}`);
    this.name = 'StorageDown';
  }
}

/**
 * Store an object and confirm it exists with the uploaded size. A file counts as stored
 * only once this resolves.
 */
export async function putObject(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  let response: Response;
  try {
    response = await send('PUT', objectKey, body, {
      'content-type': contentType,
      'content-length': String(body.byteLength),
    });
  } catch (error) {
    throw new StorageDown(String(error));
  }
  if (!response.ok) throw new StorageDown(`PUT ${response.status}`);

  let head: Response;
  try {
    head = await send('HEAD', objectKey, Buffer.alloc(0));
  } catch (error) {
    throw new StorageDown(String(error));
  }
  if (!head.ok) throw new StorageDown(`HEAD ${head.status}`);
  const length = Number(head.headers.get('content-length'));
  if (length !== body.byteLength) throw new StorageDown('stored size does not match');
}

export async function getObject(objectKey: string): Promise<{ body: Buffer; contentType: string }> {
  let response: Response;
  try {
    response = await send('GET', objectKey, Buffer.alloc(0));
  } catch (error) {
    throw new StorageDown(String(error));
  }
  if (!response.ok) throw new StorageDown(`GET ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    body: buffer,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send('HEAD', '', Buffer.alloc(0));
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Create the bucket when it is missing. The bucket's policy is never touched. */
export async function ensureBucket(): Promise<void> {
  try {
    const head = await send('HEAD', '', Buffer.alloc(0));
    if (head.status !== 404) return;
    await send('PUT', '', Buffer.alloc(0));
  } catch {
    // The server starts without object storage and reports it on /health.
  }
}
