import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';
import { ProviderDownError, timeoutSignal } from './providers';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(method: string, objectKey: string | null, body: Buffer): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const segments = objectKey === null ? [config.s3.bucket] : [config.s3.bucket, ...objectKey.split('/')];
  const canonicalPath = `/${segments.map(encodePathSegment).join('/')}`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const shortDate = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const host = endpoint.host;

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${shortDate}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, shortDate);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    url: `${endpoint.origin}${canonicalPath}`,
    headers: {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      authorization: `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function call(
  method: string,
  objectKey: string | null,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, objectKey, body);
  try {
    return await fetch(signed.url, {
      method,
      headers: { ...signed.headers, ...extraHeaders },
      body: method === 'PUT' && body.length > 0 ? new Uint8Array(body) : undefined,
      signal: timeoutSignal(),
    });
  } catch (error) {
    throw new ProviderDownError('minio', String(error));
  }
}

export async function putObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
  const response = await call('PUT', objectKey, body, { 'content-type': contentType });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new ProviderDownError('minio', `PUT ${objectKey} returned ${response.status}`);
  }
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export async function getObject(objectKey: string): Promise<StoredObject | null> {
  const response = await call('GET', objectKey, Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) throw new ProviderDownError('minio', `GET ${objectKey} returned ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  return { body, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

/** Confirms the object is in the bucket at the key given. */
export async function headObject(objectKey: string): Promise<boolean> {
  const response = await call('HEAD', objectKey, Buffer.alloc(0));
  if (response.status === 404) return false;
  if (!response.ok) throw new ProviderDownError('minio', `HEAD ${objectKey} returned ${response.status}`);
  return true;
}

export async function ensureBucket(): Promise<void> {
  const head = await call('HEAD', null, Buffer.alloc(0));
  if (head.ok) return;
  if (head.status !== 404) {
    throw new ProviderDownError('minio', `HEAD bucket returned ${head.status}`);
  }
  const created = await call('PUT', null, Buffer.alloc(0));
  if (!created.ok && created.status !== 409) {
    throw new ProviderDownError('minio', `PUT bucket returned ${created.status}`);
  }
}

export async function fileStoreReachable(): Promise<boolean> {
  try {
    const response = await call('HEAD', null, Buffer.alloc(0));
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export function invoiceObjectKey(hotelId: string, invoiceNumber: string): string {
  return `invoices/${hotelId}/${invoiceNumber}.pdf`;
}

export function idPhotoObjectKey(hotelId: string, stayId: string): string {
  return `id-photos/${hotelId}/${stayId}`;
}
