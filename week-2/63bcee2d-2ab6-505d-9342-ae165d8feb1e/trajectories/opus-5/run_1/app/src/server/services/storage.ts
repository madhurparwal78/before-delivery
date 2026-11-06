/** The S3-compatible bucket. Every uploaded file and transmittal lives here. */

import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { storageUnavailable } from '../http/errors.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(bucket: string, key: string): string {
  const keyPath = key === '' ? '' : `/${key.split('/').map(encodePathSegment).join('/')}`;
  return config.s3.forcePathStyle ? `/${encodePathSegment(bucket)}${keyPath}` : keyPath || '/';
}

interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

function signRequest(method: string, key: string, body: Buffer | undefined, extra: Record<string, string>): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const path = canonicalPath(config.s3.bucket, key);
  const host = endpoint.host;
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extra,
  };
  if (body) headers['content-length'] = String(body.byteLength);

  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${String(headers[name] ?? headerByLowerName(headers, name)).trim()}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers.authorization = `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `${endpoint.origin}${path}`,
    method,
    headers,
    ...(body ? { body } : {}),
  };
}

function headerByLowerName(headers: Record<string, string>, lower: string): string {
  const found = Object.entries(headers).find(([name]) => name.toLowerCase() === lower);
  return found ? found[1] : '';
}

async function send(request: SignedRequest): Promise<Response> {
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body ? { body: new Uint8Array(request.body) } : {}),
    });
  } catch {
    throw storageUnavailable();
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const response = await send(
    signRequest('PUT', key, body, { 'content-type': contentType }),
  );
  if (!response.ok) throw storageUnavailable();
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send(signRequest('GET', key, undefined, {}));
  if (!response.ok) throw storageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send(signRequest('HEAD', key, undefined, {}));
  if (response.status === 404) return false;
  if (!response.ok) throw storageUnavailable();
  return true;
}

/** Makes sure the configured bucket is there, ignoring an existing one. */
export async function ensureBucket(): Promise<void> {
  const head = await send(signRequest('HEAD', '', undefined, {}));
  await head.arrayBuffer();
  if (head.ok) return;
  const created = await send(signRequest('PUT', '', Buffer.alloc(0), {}));
  await created.arrayBuffer();
  if (!created.ok && created.status !== 409) throw storageUnavailable();
}
