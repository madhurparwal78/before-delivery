import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.ts';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 5000;

const sha256Hex = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: Uint8Array | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

const encodePathSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const encodeKey = (key: string): string => key.split('/').map(encodePathSegment).join('/');

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

const signRequest = (
  method: string,
  path: string,
  payload: Uint8Array,
  extraHeaders: Record<string, string>,
): SignedRequest => {
  const endpoint = new URL(config.s3.endpoint);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = { host: endpoint.host };
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers[name.toLowerCase()] = value;
  }
  headers['x-amz-content-sha256'] = payloadHash;
  headers['x-amz-date'] = amzDate;

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${(headers[name] ?? '').trim()}\n`)
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
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${endpoint.origin}${path}`, headers };
};

const send = async (
  method: string,
  path: string,
  payload: Uint8Array,
  extraHeaders: Record<string, string> = {},
): Promise<Response> => {
  const signed = signRequest(method, path, payload, extraHeaders);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : payload,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const bucketPath = (): string => `/${encodePathSegment(config.s3.bucket)}`;
const objectPath = (key: string): string => `${bucketPath()}/${encodeKey(key)}`;

export class StorageUnavailable extends Error {}

const unavailable = (cause: unknown): never => {
  throw new StorageUnavailable(cause instanceof Error ? cause.message : 'storage unreachable');
};

export const putObject = async (key: string, bytes: Uint8Array): Promise<void> => {
  let response: Response;
  try {
    response = await send('PUT', objectPath(key), bytes, {
      'content-type': 'application/pdf',
      'content-length': String(bytes.byteLength),
    });
  } catch (error) {
    return unavailable(error);
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    return unavailable(new Error(`PUT ${key} ${response.status}`));
  }
  await response.arrayBuffer().catch(() => undefined);
};

export const getObject = async (key: string): Promise<Buffer | null> => {
  let response: Response;
  try {
    response = await send('GET', objectPath(key), new Uint8Array());
  } catch (error) {
    return unavailable(error);
  }
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    return unavailable(new Error(`GET ${key} ${response.status}`));
  }
  return Buffer.from(await response.arrayBuffer());
};

export const ensureBucket = async (): Promise<void> => {
  const head = await send('HEAD', bucketPath(), new Uint8Array());
  await head.arrayBuffer().catch(() => undefined);
  if (head.ok) return;
  const created = await send('PUT', bucketPath(), new Uint8Array(), { 'content-length': '0' });
  await created.arrayBuffer().catch(() => undefined);
};

export const checkStorage = async (): Promise<boolean> => {
  try {
    const response = await send('HEAD', bucketPath(), new Uint8Array());
    await response.arrayBuffer().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
};

export const originalKey = (documentId: string): string => `documents/${documentId}/original.pdf`;
export const completedKey = (documentId: string): string => `documents/${documentId}/completed.pdf`;
export const templateKey = (templateId: string): string => `templates/${templateId}/original.pdf`;
