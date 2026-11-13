import { createHash, createHmac } from 'node:crypto';
import { config } from './config.ts';

/**
 * The evidence store. Objects live only in the bucket named by S3_BUCKET, and
 * the app creates exactly that bucket if the store answers without it.
 */

const SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export class StoreUnavailableError extends Error {}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, path: string, payload: Buffer | null, extraHeaders: Record<string, string>): SignedRequest {
  const endpoint = new URL(config.store.endpoint);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = stamp.slice(0, 8);
  const payloadHash = payload === null ? EMPTY_SHA256 : createHash('sha256').update(payload).digest('hex');

  const headers = new Map<string, string>([
    ['host', endpoint.host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', stamp],
  ]);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name.toLowerCase(), value);

  const sortedNames = [...headers.keys()].sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${(headers.get(name) as string).trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${config.store.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.store.secretAccessKey}`, date), config.store.region), SERVICE), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${config.store.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  return { url: `${endpoint.origin}${path}`, headers: Object.fromEntries(headers) };
}

function objectPath(key: string): string {
  const segments = key.split('/').map(encodeSegment).join('/');
  return config.store.forcePathStyle ? `/${encodeSegment(config.store.bucket)}/${segments}` : `/${segments}`;
}

function bucketPath(): string {
  return `/${encodeSegment(config.store.bucket)}`;
}

async function send(
  method: string,
  path: string,
  payload: Buffer | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, path, payload, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: payload === null ? undefined : new Uint8Array(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new StoreUnavailableError('The evidence store is not answering.');
  }
}

async function createBucket(): Promise<void> {
  const response = await send('PUT', bucketPath(), Buffer.alloc(0));
  if (!response.ok && response.status !== 409) {
    await response.arrayBuffer();
    throw new StoreUnavailableError(`The evidence store refused to create the bucket (${response.status}).`);
  }
  await response.arrayBuffer();
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let response = await send('PUT', objectPath(key), body, { 'content-type': contentType });
  if (response.status === 404) {
    await response.arrayBuffer();
    await createBucket();
    response = await send('PUT', objectPath(key), body, { 'content-type': contentType });
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StoreUnavailableError(`The evidence store refused the write (${response.status}).`);
  }
  await response.arrayBuffer();
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', objectPath(key), null);
  if (!response.ok && response.status !== 404) {
    await response.arrayBuffer();
    throw new StoreUnavailableError(`The evidence store refused the delete (${response.status}).`);
  }
  await response.arrayBuffer();
}
