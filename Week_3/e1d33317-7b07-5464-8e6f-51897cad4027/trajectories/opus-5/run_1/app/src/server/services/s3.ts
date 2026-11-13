import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { errors } from '../errors.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 4000;

function sha256(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

function sign(
  method: string,
  objectPath: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): SignedRequest {
  const base = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${objectPath}`
    : objectPath;
  const url = new URL(path, base);
  const { amzDate, dateStamp } = stamps(new Date());
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    encodePath(decodeURIComponent(url.pathname)),
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: url.toString(), method, headers, body };
}

async function send(request: SignedRequest): Promise<Response> {
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : new Uint8Array(request.body ?? Buffer.alloc(0)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw errors.storageUnavailable();
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send(sign('HEAD', '/', Buffer.alloc(0)));
  if (head.ok || head.status === 403) return;
  const made = await send(sign('PUT', '/', Buffer.alloc(0)));
  if (!made.ok && made.status !== 409) throw errors.storageUnavailable();
}

/** Writes an object and only returns once storage has confirmed the write. */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const response = await send(
    sign('PUT', `/${key}`, body, { 'content-type': contentType }),
  );
  if (!response.ok) throw errors.storageUnavailable();
  await response.arrayBuffer();
  const confirmation = await send(sign('HEAD', `/${key}`, Buffer.alloc(0)));
  if (!confirmation.ok) throw errors.storageUnavailable();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send(sign('GET', `/${key}`, Buffer.alloc(0)));
  if (response.status === 404) return null;
  if (!response.ok) throw errors.storageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send(sign('HEAD', '/', Buffer.alloc(0)));
    return response.ok || response.status === 403 || response.status === 404;
  } catch {
    return false;
  }
}

export const objectKeys = {
  bank: (scoreId: string, bankId: string, fileName: string): string =>
    `scores/${scoreId}/banks/${bankId}/${fileName}`,
  partPage: (scoreId: string, partId: string, revision: number, page: number): string =>
    `scores/${scoreId}/parts/${partId}/r${revision}/page-${page}.svg`,
  partPdf: (scoreId: string, partId: string, revision: number): string =>
    `scores/${scoreId}/parts/${partId}/r${revision}/part.pdf`,
};
