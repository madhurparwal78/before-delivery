import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const SERVICE = 's3';
const REQUEST_TIMEOUT_MS = 5_000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { full: string; short: string } {
  const full = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { full, short: full.slice(0, 8) };
}

function encodeKeyPath(objectKey: string): string {
  return objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** AWS Signature Version 4 over the configured endpoint, signing host, date and payload. */
function signedRequest(
  method: string,
  path: string,
  body: Buffer,
  contentType: string | null,
): { url: string; headers: Record<string, string> } {
  const endpoint = new URL(config.s3.endpoint);
  const { full, short } = amzDate(new Date());
  const payloadHash = sha256Hex(body);

  const signable: Array<[string, string]> = [
    ['host', endpoint.host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', full],
  ];
  if (contentType !== null) signable.push(['content-type', contentType]);
  signable.sort(([left], [right]) => (left < right ? -1 : 1));

  const signedHeaders = signable.map(([name]) => name).join(';');
  const canonicalHeaders = signable.map(([name, value]) => `${name}:${value.trim()}\n`).join('');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${short}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', full, scope, sha256Hex(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, short);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const headers: Record<string, string> = Object.fromEntries(signable.filter(([name]) => name !== 'host'));
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.origin}${path}`, headers };
}

/** Raised when file storage cannot be reached, so callers answer `storage_unavailable`. */
export class StorageUnavailable extends Error {
  constructor(cause: string) {
    super(`File storage is unavailable: ${cause}`);
    this.name = 'StorageUnavailable';
  }
}

export function storageError(): AppError {
  return new AppError('storage_unavailable');
}

/**
 * The fetch body types accept a view over a plain `ArrayBuffer`, while a `Buffer` may sit on
 * a `SharedArrayBuffer`, so the payload is copied into its own view.
 */
function bodyPart(body: Buffer): Uint8Array<ArrayBuffer> {
  const view = new Uint8Array(body.byteLength);
  view.set(body);
  return view;
}

async function send(method: string, path: string, body: Buffer, contentType: string | null): Promise<Response> {
  const signed = signedRequest(method, path, body, contentType);
  const init: RequestInit = {
    method,
    headers: signed.headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (body.length > 0) init.body = bodyPart(body);
  try {
    return await fetch(signed.url, init);
  } catch (error) {
    throw new StorageUnavailable((error as Error).message);
  }
}

function objectPath(objectKey: string): string {
  return config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${encodeKeyPath(objectKey)}`
    : `/${encodeKeyPath(objectKey)}`;
}

export async function putObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', objectPath(objectKey), body, contentType);
  if (!response.ok) throw new StorageUnavailable(`PUT ${objectKey} answered ${response.status}`);
}

export interface StoredObject {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export async function getObject(objectKey: string): Promise<StoredObject | null> {
  const response = await send('GET', objectPath(objectKey), Buffer.alloc(0), null);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`GET ${objectKey} answered ${response.status}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function deleteObject(objectKey: string): Promise<void> {
  const response = await send('DELETE', objectPath(objectKey), Buffer.alloc(0), null);
  // MinIO answers 204 for a delete and 404 when the object has already gone.
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(`DELETE ${objectKey} answered ${response.status}`);
  }
}

/** Creates the bucket when it is missing, so a fresh MinIO serves the app. */
export async function ensureBucket(): Promise<void> {
  const response = await send('PUT', `/${config.s3.bucket}`, Buffer.alloc(0), null);
  // 409 means the bucket is already there, which is the normal case.
  if (!response.ok && response.status !== 409) {
    throw new StorageUnavailable(`bucket create answered ${response.status}`);
  }
}

export async function storageIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${new URL(config.s3.endpoint).origin}/minio/health/live`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const objectKeys = {
  image: (workshopId: string, imageId: string): string => `workshops/${workshopId}/images/${imageId}`,
  recapPdf: (workshopId: string): string => `workshops/${workshopId}/recap/board.pdf`,
  recapCsv: (workshopId: string): string => `workshops/${workshopId}/recap/notes.csv`,
  recapFramePng: (workshopId: string, frameId: string): string =>
    `workshops/${workshopId}/recap/frames/${frameId}.png`,
} as const;
