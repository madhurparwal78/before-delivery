import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.ts';

export class StorageUnavailable extends Error {}

const SERVICE = 's3';
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

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function sign(method: string, key: string, payload: Buffer): SignedRequest {
  const endpoint = new URL(config.s3.endpoint);
  const encodedKey = encodeKeyPath(key);
  const path = config.s3.forcePathStyle
    ? `/${encodeURIComponent(config.s3.bucket)}/${encodedKey}`
    : `/${encodedKey}`;
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;

  // Signatures use real wall-clock time so the object store accepts them whatever the app clock says.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateOnly = stamp.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateOnly}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateOnly);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    url: `${endpoint.origin}${path}`,
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function call(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, key, payload);
  try {
    return await fetch(signed.url, {
      method,
      headers: { ...signed.headers, ...extraHeaders },
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable('object storage is unreachable');
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await call('PUT', key, body, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
  });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnavailable(`object storage refused the write (${response.status})`);
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await call('GET', key, Buffer.alloc(0));
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageUnavailable(`object storage refused the read (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call('DELETE', key, Buffer.alloc(0));
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok && response.status !== 404) {
    throw new StorageUnavailable(`object storage refused the delete (${response.status})`);
  }
}
