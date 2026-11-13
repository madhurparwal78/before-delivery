import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const REQUEST_TIMEOUT_MS = 5000;

function sha256(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function signedRequest(
  method: string,
  objectPath: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): { url: string; headers: Record<string, string> } {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalUri = `/${objectPath.split('/').map(encodePathSegment).join('/')}`;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body.length === 0 ? EMPTY_SHA256 : sha256(body);

  const headers: Record<string, string> = { host: endpoint.host };
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
  headers['x-amz-content-sha256'] = payloadHash;
  headers['x-amz-date'] = amzDate;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${endpoint.origin}${canonicalUri}`, headers };
}

async function send(
  method: string,
  objectPath: string,
  body: Buffer = Buffer.alloc(0),
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const { url, headers } = signedRequest(method, objectPath, body, extraHeaders);
  return fetch(url, {
    method,
    headers,
    body: body.length === 0 ? undefined : body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Raised when MinIO cannot be reached or refuses a call. */
export class StorageFailure extends Error {}

function objectPath(key: string): string {
  return config.s3.forcePathStyle ? `${config.s3.bucket}/${key}` : key;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let response: Response;
  try {
    response = await send('PUT', objectPath(key), body, { 'content-type': contentType });
  } catch {
    throw new StorageFailure(`put ${key} failed`);
  }
  if (!response.ok) throw new StorageFailure(`put ${key} answered ${response.status}`);
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  let response: Response;
  try {
    response = await send('GET', objectPath(key));
  } catch {
    throw new StorageFailure(`get ${key} failed`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageFailure(`get ${key} answered ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { body: buffer, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function deleteObject(key: string): Promise<void> {
  let response: Response;
  try {
    response = await send('DELETE', objectPath(key));
  } catch {
    throw new StorageFailure(`delete ${key} failed`);
  }
  if (!response.ok && response.status !== 404) {
    throw new StorageFailure(`delete ${key} answered ${response.status}`);
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', config.s3.bucket);
  if (head.ok) return;
  const created = await send('PUT', config.s3.bucket);
  if (!created.ok && created.status !== 409) {
    throw new StorageFailure(`create bucket answered ${created.status}`);
  }
}

export const storageKeys = {
  checkpoint: (notebookId: string, checkpointId: string): string =>
    `notebooks/${notebookId}/checkpoints/${checkpointId}.json`,
  original: (notebookId: string): string => `notebooks/${notebookId}/original.ipynb`,
  export: (notebookId: string, exportId: string): string =>
    `notebooks/${notebookId}/exports/${exportId}.ipynb`,
  attachment: (notebookId: string, cellId: string, name: string): string =>
    `notebooks/${notebookId}/attachments/${cellId}/${name}`,
  working: (notebookId: string): string => `notebooks/${notebookId}/working.json`,
};

let lastProbe = { at: 0, ok: false };

/** The storage state behind /api/health, at most 5 seconds old. */
export async function storageReachable(): Promise<boolean> {
  if (Date.now() - lastProbe.at < 5000) return lastProbe.ok;
  let ok = false;
  try {
    const response = await send('HEAD', config.s3.bucket);
    ok = response.ok;
  } catch {
    ok = false;
  }
  lastProbe = { at: Date.now(), ok };
  return ok;
}
