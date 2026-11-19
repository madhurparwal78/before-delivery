import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('Storage is unavailable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

const EMPTY_HASH = sha256Hex('');

function amzDate(now: Date): { stamp: string; dateOnly: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, dateOnly: stamp.slice(0, 8) };
}

function encodePath(segments: string[]): string {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

interface S3Response {
  status: number;
  body: Buffer;
  headers: Headers;
}

async function send(
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
  objectKey: string | null,
  query: Record<string, string>,
  body: Buffer | null,
  contentType: string | null,
  timeoutMs: number,
): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const segments = config.s3.forcePathStyle ? [config.s3.bucket] : [];
  if (objectKey !== null) segments.push(...objectKey.split('/'));
  const canonicalUri = encodePath(segments);
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;

  const now = new Date();
  const { stamp, dateOnly } = amzDate(now);
  const payloadHash = body ? sha256Hex(body) : EMPTY_HASH;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (contentType) headers['content-type'] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key]!)}`)
    .join('&');

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateOnly}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateOnly);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `${endpoint.protocol}//${endpoint.host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`;

  const requestHeaders: Record<string, string> = { ...headers, authorization };
  delete requestHeaders['host'];

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ?? undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const buffer = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body: buffer, headers: response.headers };
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

function assertUsable(response: S3Response): S3Response {
  if (response.status >= 500) throw new StorageUnavailable(response.status);
  return response;
}

export const storage = {
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = assertUsable(await send('PUT', key, {}, body, contentType, 10_000));
    if (response.status >= 400) throw new StorageUnavailable(response.status);
  },

  async getObject(key: string): Promise<Buffer | null> {
    const response = assertUsable(await send('GET', key, {}, null, null, 10_000));
    if (response.status === 404) return null;
    if (response.status >= 400) throw new StorageUnavailable(response.status);
    return response.body;
  },

  async headObject(key: string): Promise<{ contentLength: number } | null> {
    const response = assertUsable(await send('HEAD', key, {}, null, null, 10_000));
    if (response.status === 404) return null;
    if (response.status >= 400) throw new StorageUnavailable(response.status);
    return { contentLength: Number(response.headers.get('content-length') ?? '0') };
  },

  async deleteObject(key: string): Promise<void> {
    const response = assertUsable(await send('DELETE', key, {}, null, null, 10_000));
    if (response.status >= 400 && response.status !== 404) throw new StorageUnavailable(response.status);
  },

  async listKeys(): Promise<string[]> {
    const keys: string[] = [];
    let token: string | null = null;
    for (;;) {
      const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' };
      if (token) query['continuation-token'] = token;
      const response = assertUsable(await send('GET', null, query, null, null, 10_000));
      if (response.status >= 400) throw new StorageUnavailable(response.status);
      const xml = response.body.toString('utf8');
      for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
        keys.push(decodeXml(match[1]!));
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
      if (!truncated || !next) break;
      token = decodeXml(next[1]!);
    }
    return keys;
  },

  async ensureBucket(): Promise<void> {
    const response = await send('HEAD', null, {}, null, null, 5000);
    if (response.status === 404) {
      await send('PUT', null, {}, Buffer.alloc(0), null, 5000);
    }
  },

  async isReachable(): Promise<boolean> {
    try {
      const response = await send('HEAD', null, {}, null, null, 800);
      return response.status < 500;
    } catch {
      return false;
    }
  },
};

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function masterKey(assetId: string, fileName: string): string {
  return `masters/${assetId}/${fileName}`;
}

export function derivativeKey(assetId: string, variantKey: string | null, fileName: string): string {
  return `derivatives/${assetId}/${variantKey ?? 'base'}/${fileName}`;
}

export function proofKey(grantId: string, proofId: string): string {
  return `proofs/${grantId}/${proofId}`;
}
