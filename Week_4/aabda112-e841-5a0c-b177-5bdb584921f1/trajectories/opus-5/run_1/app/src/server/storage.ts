import { createHash, createHmac } from 'node:crypto';
import { config } from './config';
import { AppError } from './errors';

const SERVICE = 's3';
const TIMEOUT_MS = 2_000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function objectPath(key: string): string {
  const encoded = key.split('/').map(encodePathSegment).join('/');
  return config.s3ForcePathStyle ? `/${config.s3Bucket}/${encoded}` : `/${encoded}`;
}

type SignedRequest = { url: string; headers: Record<string, string> };

function signRequest(
  method: string,
  path: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): SignedRequest {
  const endpoint = new URL(config.s3Endpoint);
  const host = config.s3ForcePathStyle ? endpoint.host : `${config.s3Bucket}.${endpoint.host}`;
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const sortedKeys = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = sortedKeys
    .map((name) => `${name}:${String(headers[name] ?? headers[name.toLowerCase()]).trim()}\n`)
    .join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3Region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3SecretAccessKey}`, dateStamp), config.s3Region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.origin}${path}`, headers };
}

async function callStorage(
  method: string,
  path: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(method, path, payload, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' ? new Uint8Array(payload) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError('storage_unavailable');
  }
}

/** An upload says the file was not saved; a download or export says only that. */
export async function putUpload(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await putObject(key, body, contentType);
  } catch (error) {
    if (error instanceof AppError && error.code === 'storage_unavailable') {
      throw new AppError('storage_unavailable', {
        copy: 'File storage is unavailable. Your file was not saved.',
      });
    }
    throw error;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await callStorage('PUT', objectPath(key), body, {
    'content-type': contentType,
  });
  if (!response.ok) throw new AppError('storage_unavailable');
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await callStorage('GET', objectPath(key), Buffer.alloc(0));
  if (!response.ok) throw new AppError('storage_unavailable');
  return Buffer.from(await response.arrayBuffer());
}

export async function storageReachable(): Promise<boolean> {
  try {
    const path = config.s3ForcePathStyle ? `/${config.s3Bucket}` : '/';
    const response = await callStorage('HEAD', path, Buffer.alloc(0));
    return response.status < 500;
  } catch {
    return false;
  }
}

export function fileObjectKey(
  clinicId: string,
  patientId: string,
  fileId: string,
  fileName: string,
): string {
  const safeName = fileName.replace(/[/\\\u0000-\u001f\u007f]/g, '_');
  return `clinics/${clinicId}/patients/${patientId}/${fileId}-${safeName}`;
}

export function exportObjectKey(
  clinicId: string,
  kind: 'history' | 'invoice',
  id: string,
  epochSeconds: number,
): string {
  return `clinics/${clinicId}/exports/${kind}-${id}-${epochSeconds}.pdf`;
}
