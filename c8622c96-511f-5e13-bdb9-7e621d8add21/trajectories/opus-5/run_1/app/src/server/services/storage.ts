import { config } from '../config.js';
import { storageUnavailable } from '../http/errors.js';
import { canonicalQuery, encodeRfc3986, sha256Hex, signature, UNSIGNED_PAYLOAD } from './sigv4.js';

const keys = {
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey,
  region: config.s3.region,
  service: 's3',
};

function objectUrl(key: string): { url: URL; canonicalPath: string } {
  const encodedKey = encodeRfc3986(key, true);
  const path = config.s3.forcePathStyle
    ? `/${encodeRfc3986(config.s3.bucket)}/${encodedKey}`
    : `/${encodedKey}`;
  const url = new URL(config.s3.endpoint);
  if (!config.s3.forcePathStyle) url.host = `${config.s3.bucket}.${url.host}`;
  url.pathname = path;
  return { url, canonicalPath: path };
}

async function send(
  method: string,
  key: string,
  options: { body?: Buffer; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Response> {
  const { url, canonicalPath } = objectUrl(key);
  const body = options.body;
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const now = new Date();
  const headers: Array<[string, string]> = [
    ['host', url.host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`],
    ...Object.entries(options.headers ?? {}),
  ];
  const signed = signature(keys, now, {
    method,
    path: canonicalPath,
    query: '',
    headers,
    payloadHash,
  });
  const requestHeaders: Record<string, string> = Object.fromEntries(headers);
  requestHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${keys.accessKeyId}/${signed.credentialScope}, SignedHeaders=${signed.signedHeaders}, Signature=${signed.signature}`;
  try {
    return await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ?? null,
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
  } catch {
    throw storageUnavailable();
  }
}

export async function putOriginal(essayId: string, frameId: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', `originals/${essayId}/${frameId}`, {
    body,
    headers: { 'content-type': contentType },
    timeoutMs: 15_000,
  });
  if (!response.ok) throw storageUnavailable();
}

export async function putDerivative(
  essayId: string,
  frameId: string,
  variant: 'grid' | 'story' | 'preview',
  body: Buffer,
): Promise<void> {
  const response = await send('PUT', `derivatives/${essayId}/${frameId}/${variant}.jpg`, {
    body,
    headers: { 'content-type': 'image/jpeg' },
    timeoutMs: 15_000,
  });
  if (!response.ok) throw storageUnavailable();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', key, { timeoutMs: 10_000 });
  if (response.status === 404) return null;
  if (!response.ok) throw storageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key);
  if (!response.ok && response.status !== 404) throw storageUnavailable();
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send('HEAD', key);
  if (response.status === 404) return false;
  if (!response.ok) throw storageUnavailable();
  return true;
}

export async function moveToLegalHold(essayId: string, frameId: string): Promise<void> {
  const source = `/${config.s3.bucket}/originals/${essayId}/${frameId}`;
  const response = await send('PUT', `legal-hold/${essayId}/${frameId}`, {
    headers: { 'x-amz-copy-source': encodeRfc3986(source, true) },
    timeoutMs: 15_000,
  });
  if (!response.ok && response.status !== 404) throw storageUnavailable();
  await deleteObject(`originals/${essayId}/${frameId}`);
}

export async function putGrantRecord(licenceId: string, record: unknown): Promise<void> {
  const response = await send('PUT', `grants/${licenceId}.json`, {
    body: Buffer.from(JSON.stringify(record), 'utf8'),
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok) throw storageUnavailable();
}

export async function deleteGrantRecord(licenceId: string): Promise<void> {
  await deleteObject(`grants/${licenceId}.json`);
}

export async function grantRecordExists(licenceId: string): Promise<boolean> {
  return objectExists(`grants/${licenceId}.json`);
}

/** A signed GET for exactly one original, with its download name and type fixed. */
export function presignOriginal(
  essayId: string,
  frameId: string,
  seconds: number,
  filename: string,
  contentType: string,
): string {
  const { url, canonicalPath } = objectUrl(`originals/${essayId}/${frameId}`);
  const now = new Date();
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = stamp.slice(0, 8);
  const params: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${keys.accessKeyId}/${date}/${keys.region}/s3/aws4_request`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(seconds)],
    ['X-Amz-SignedHeaders', 'host'],
    ['response-content-disposition', `attachment; filename="${filename}"`],
    ['response-content-type', contentType],
  ];
  const query = canonicalQuery(params);
  const signed = signature(keys, now, {
    method: 'GET',
    path: canonicalPath,
    query,
    headers: [['host', url.host]],
    payloadHash: UNSIGNED_PAYLOAD,
  });
  return `${url.origin}${canonicalPath}?${query}&X-Amz-Signature=${signed.signature}`;
}

export async function ensureBucket(): Promise<void> {
  const url = new URL(config.s3.endpoint);
  url.pathname = `/${encodeRfc3986(config.s3.bucket)}`;
  const now = new Date();
  const payloadHash = sha256Hex(Buffer.alloc(0));
  const headers: Array<[string, string]> = [
    ['host', url.host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`],
  ];
  const signed = signature(keys, now, {
    method: 'PUT',
    path: url.pathname,
    query: '',
    headers,
    payloadHash,
  });
  const requestHeaders: Record<string, string> = Object.fromEntries(headers);
  requestHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${keys.accessKeyId}/${signed.credentialScope}, SignedHeaders=${signed.signedHeaders}, Signature=${signed.signature}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: requestHeaders,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok && response.status !== 409) throw storageUnavailable();
}
