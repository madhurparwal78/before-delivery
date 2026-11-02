import crypto from 'node:crypto';
import { env } from '../env.js';
import { filesUnavailable } from '../http/errors.js';
import { markService } from './health.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const EMPTY_BODY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

function sha256Hex(payload: Buffer | string): string {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(
  method: string,
  objectKey: string | null,
  body: Buffer | null,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(env.s3.endpoint);
  const objectPath = objectKey === null ? '' : `/${encodePath(objectKey)}`;
  const canonicalPath = env.s3.forcePathStyle
    ? `/${encodeURIComponent(env.s3.bucket)}${objectPath}`
    : objectPath === ''
      ? '/'
      : objectPath;
  const host = env.s3.forcePathStyle
    ? endpoint.host
    : `${env.s3.bucket}.${endpoint.host}`;

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body === null ? EMPTY_BODY_SHA256 : sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowerHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()]),
  );
  const canonicalHeaders = sortedNames.map((name) => `${name}:${lowerHeaders.get(name)}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    method,
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${env.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${env.s3.secretAccessKey}`, dateStamp), env.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    url: `${endpoint.protocol}//${host}${canonicalPath}`,
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${env.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function send(
  method: string,
  objectKey: string | null,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, objectKey, body, extraHeaders);
  const response = await fetch(signed.url, {
    method,
    headers: signed.headers,
    body: body ?? undefined,
    signal: AbortSignal.timeout(10_000),
  });
  markService('minio', true);
  return response;
}

async function sendOrOutage(
  method: string,
  objectKey: string | null,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  try {
    return await send(method, objectKey, body, extraHeaders);
  } catch {
    markService('minio', false);
    throw filesUnavailable();
  }
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

/** Writes an object once. An object already in the bucket is never overwritten. */
export async function putObjectOnce(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (await objectExists(key)) return;
  const response = await sendOrOutage('PUT', key, body, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
  });
  if (!response.ok) throw filesUnavailable();
}

async function objectExists(key: string): Promise<boolean> {
  const response = await sendOrOutage('HEAD', key, null);
  if (response.status === 404) return false;
  if (!response.ok) throw filesUnavailable();
  return true;
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const response = await sendOrOutage('GET', key, null);
  if (response.status === 404) return null;
  if (!response.ok) throw filesUnavailable();
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function probeFiles(): Promise<void> {
  const response = await send('HEAD', null, null);
  if (!response.ok) throw new Error(`bucket check answered ${response.status}`);
}

export const objectKeys = {
  invoice: (orderNumber: string) => `orders/${orderNumber}/invoice.pdf`,
  packingSlip: (orderNumber: string) => `orders/${orderNumber}/packing-slip.pdf`,
  licence: (applicationId: string, extension: string) =>
    `licences/${applicationId}/licence.${extension}`,
} as const;
