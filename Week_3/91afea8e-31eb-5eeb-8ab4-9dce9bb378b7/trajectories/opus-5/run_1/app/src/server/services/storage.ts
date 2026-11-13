/** MinIO object storage, signed with SigV4. The app streams files; the browser never reads it. */

import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

const TIMEOUT_MS = 5_000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

type S3Request = {
  method: 'GET' | 'PUT' | 'HEAD';
  key: string;
  body?: Buffer;
  contentType?: string;
};

async function send(request: S3Request): Promise<{ status: number; body: Buffer } | null> {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${encodeKeyPath(request.key)}`
    : `/${encodeKeyPath(request.key)}`;
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;
  const payload = request.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
  const shortDate = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (request.contentType !== undefined) headers['content-type'] = request.contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    request.method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${shortDate}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, shortDate), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint.origin}${path}`, {
      method: request.method,
      headers,
      body: request.method === 'PUT' ? payload : undefined,
      signal: controller.signal,
    });
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<boolean> {
  const reply = await send({ method: 'PUT', key, body, contentType });
  return reply !== null && reply.status < 300;
}

export async function getObject(key: string): Promise<Buffer | null> {
  const reply = await send({ method: 'GET', key });
  if (reply === null || reply.status >= 300) return null;
  return reply.body;
}


export const objectKeys = {
  invoice: (orderId: string, shipmentId: string) => `invoices/${orderId}/${shipmentId}.pdf`,
  label: (orderId: string, shipmentId: string) => `labels/${orderId}/${shipmentId}.pdf`,
  photo: (listingId: string, photoId: string, ext: string) =>
    `listings/${listingId}/${photoId}.${ext}`,
  gstCertificate: (sellerId: string, ext: string) =>
    `sellers/${sellerId}/gst-certificate.${ext}`,
} as const;
