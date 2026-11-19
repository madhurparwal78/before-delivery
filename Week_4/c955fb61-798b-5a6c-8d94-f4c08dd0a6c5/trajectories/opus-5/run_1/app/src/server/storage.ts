import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const SERVICE = 's3';
const REQUEST_TIMEOUT_MS = 5000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

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

function sign(method: string, key: string, payload: Buffer, extraHeaders: Record<string, string>): SignedRequest {
  const base = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${key.split('/').map(encodeSegment).join('/')}`
    : `/${key.split('/').map(encodeSegment).join('/')}`;
  const host = config.s3.forcePathStyle ? base.host : `${config.s3.bucket}.${base.host}`;

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    url: `${base.protocol}//${host}${path}`,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function request(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, key, payload, extraHeaders);
  const { host, ...sendHeaders } = signed.headers;
  void host;
  return fetch(signed.url, {
    method,
    headers: sendHeaders,
    body: method === 'PUT' ? new Uint8Array(payload) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export class StorageUnavailable extends Error {}

/** Store an export and confirm the stored object exists. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let putResponse: Response;
  try {
    putResponse = await request('PUT', key, body, { 'content-type': contentType });
  } catch {
    throw new StorageUnavailable();
  }
  if (!putResponse.ok) throw new StorageUnavailable();
  await putResponse.arrayBuffer();

  let headResponse: Response;
  try {
    headResponse = await request('HEAD', key, Buffer.alloc(0));
  } catch {
    throw new StorageUnavailable();
  }
  if (!headResponse.ok) throw new StorageUnavailable();
}

export async function getObject(key: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await request('GET', key, Buffer.alloc(0));
  } catch {
    throw new StorageUnavailable();
  }
  if (!response.ok) throw new StorageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}
