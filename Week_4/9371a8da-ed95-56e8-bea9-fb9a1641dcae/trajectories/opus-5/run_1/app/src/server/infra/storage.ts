import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { storageUnavailable } from '../http/errors.js';

const SERVICE = 's3';
const TIMEOUT_MS = 8_000;

function hash(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, key: string, payload: Buffer): SignedRequest {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const path = forcePathStyle
    ? `/${bucket}/${encodeKey(key)}`
    : `/${encodeKey(key)}`;
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = hash(payload);

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    hash(canonicalRequest),
  ].join('\n');

  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    url: `${base.origin}${path}`,
    headers: {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function call(
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
  key: string,
  body?: Buffer,
  contentType?: string,
): Promise<Response> {
  const payload = body ?? Buffer.alloc(0);
  const signed = sign(method, key, payload);
  const headers: Record<string, string> = { ...signed.headers };
  delete headers.host;
  if (contentType !== undefined) headers['content-type'] = contentType;
  try {
    return await fetch(signed.url, {
      method,
      headers,
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw storageUnavailable();
  }
}

export const storage = {
  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await call('PUT', key, bytes, contentType);
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) throw storageUnavailable();
  },

  /** Returns null when the object is absent from a reachable store. */
  async get(key: string): Promise<Buffer | null> {
    const response = await call('GET', key);
    if (response.status === 404) {
      await response.arrayBuffer().catch(() => undefined);
      return null;
    }
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      throw storageUnavailable();
    }
    try {
      return Buffer.from(await response.arrayBuffer());
    } catch {
      throw storageUnavailable();
    }
  },

  async head(key: string): Promise<{ size: number } | null> {
    const response = await call('HEAD', key);
    await response.arrayBuffer().catch(() => undefined);
    if (response.status === 404) return null;
    if (!response.ok) throw storageUnavailable();
    const length = Number(response.headers.get('content-length') ?? '0');
    return { size: Number.isFinite(length) ? length : 0 };
  },

  async remove(key: string): Promise<void> {
    const response = await call('DELETE', key);
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok && response.status !== 404) throw storageUnavailable();
  },
};

export function assetObjectKey(projectId: string, fileId: string): string {
  return `projects/${projectId}/assets/${fileId}`;
}

export function exportObjectKey(projectId: string, exportId: string): string {
  return `projects/${projectId}/exports/${exportId}.zip`;
}
