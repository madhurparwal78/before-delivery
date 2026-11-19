import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { ServiceDownError } from '../errors.js';
import { isForcedDown } from './outage.js';

const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

export const objectKey = (assetId: string, version: number): string => `assets/${assetId}/v${version}.glb`;

function stamps(): { amzDate: string; dateStamp: string } {
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signedUrl(key: string): { url: URL; path: string } {
  const base = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) {
    const path = `/${config.s3.bucket}${key === '' ? '' : `/${key}`}`;
    return { url: new URL(path, base), path };
  }
  base.hostname = `${config.s3.bucket}.${base.hostname}`;
  const path = `/${key}`;
  return { url: new URL(path, base), path };
}

async function send(
  method: 'PUT' | 'GET' | 'DELETE' | 'HEAD',
  key: string,
  body?: Uint8Array,
  contentType?: string
): Promise<Response> {
  if (isForcedDown('minio')) throw new ServiceDownError('minio');
  const { url, path } = signedUrl(key);
  const payloadHash = sha256Hex(body ?? '');
  const { amzDate, dateStamp } = stamps();
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  if (contentType !== undefined) headers['content-type'] = contentType;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalPath = path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const canonicalRequest = [method, canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : Buffer.from(body),
      signal: AbortSignal.timeout(5000)
    });
    if (response.status >= 500) throw new ServiceDownError('minio');
    return response;
  } catch (error) {
    if (error instanceof ServiceDownError) throw error;
    throw new ServiceDownError('minio');
  }
}

let storageReachable = false;

export function storageUp(): boolean {
  return storageReachable && !isForcedDown('minio');
}

export async function putObject(key: string, bytes: Uint8Array): Promise<void> {
  const response = await send('PUT', key, bytes, 'model/gltf-binary');
  if (!response.ok) throw new ServiceDownError('minio');
  storageReachable = true;
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  const response = await send('GET', key);
  storageReachable = true;
  if (response.status === 404) return null;
  if (!response.ok) throw new ServiceDownError('minio');
  return new Uint8Array(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key);
  if (!response.ok && response.status !== 404) throw new ServiceDownError('minio');
  storageReachable = true;
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '');
  if (head.status === 404) {
    const made = await send('PUT', '');
    if (!made.ok && made.status !== 409) throw new ServiceDownError('minio');
  }
  storageReachable = true;
}

export function watchStorage(): void {
  const probe = async (): Promise<void> => {
    try {
      await send('HEAD', '');
      storageReachable = true;
    } catch {
      storageReachable = false;
    }
  };
  void probe();
  setInterval(() => void probe(), 2000).unref();
}
