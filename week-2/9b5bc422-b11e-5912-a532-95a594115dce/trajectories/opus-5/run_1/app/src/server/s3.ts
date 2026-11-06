import { createHash, createHmac } from 'node:crypto';
import { config } from './config.ts';

type S3Response = { status: number; body: Buffer; headers: Record<string, string | string[] | undefined> };

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function signingKey(date: string): Buffer {
  const kDate = hmac(`AWS4${config.s3.secretAccessKey}`, date);
  const kRegion = hmac(kDate, config.s3.region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

async function s3Request(
  method: string,
  key: string,
  body: Buffer = Buffer.alloc(0),
  contentType?: string,
): Promise<S3Response> {
  const base = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${key ? `/${encodeKeyPath(key)}` : ''}`
    : `${key ? `/${encodeKeyPath(key)}` : '/'}`;
  const host = config.s3.forcePathStyle ? base.host : `${config.s3.bucket}.${base.host}`;
  const url = new URL(path, `${base.protocol}//${base.host}`);

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(date), stringToSign).toString('hex');

  const requestHeaders: Record<string, string> = {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(
      ';',
    )}, Signature=${signature}`,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
      signal: controller.signal,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const out: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      out[name] = value;
    });
    return { status: response.status, body: buffer, headers: out };
  } finally {
    clearTimeout(timer);
  }
}

export function attachmentKey(userId: string, attachmentId: string): string {
  return `attachments/${userId}/${attachmentId}`;
}

export const storage = {
  async reachable(): Promise<boolean> {
    try {
      const response = await s3Request('GET', '');
      return response.status < 500;
    } catch {
      return false;
    }
  },

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await s3Request('PUT', key, body, contentType);
    if (response.status >= 300) throw new Error(`Storage refused the object: ${response.status}`);
  },

  async get(key: string): Promise<Buffer | null> {
    const response = await s3Request('GET', key);
    if (response.status === 404) return null;
    if (response.status >= 300) throw new Error(`Storage refused the read: ${response.status}`);
    return response.body;
  },

  async remove(key: string): Promise<void> {
    const response = await s3Request('DELETE', key);
    if (response.status >= 300 && response.status !== 404) {
      throw new Error(`Storage refused the delete: ${response.status}`);
    }
  },
};
