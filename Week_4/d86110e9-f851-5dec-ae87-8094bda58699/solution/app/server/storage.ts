import { createHash, createHmac } from 'node:crypto';
import { machineMs } from './clock.js';
import { config } from './config.js';

export class StorageUnavailable extends Error {}

const TIMEOUT_MS = 5000;

function digest(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

/** A request signed with AWS Signature Version 4, which is what MinIO checks. */
async function signed(method: 'PUT' | 'HEAD', key: string, body: Buffer, contentType?: string): Promise<Response> {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
  const url = new URL(endpoint);
  const path = encodePath(key === '' ? `/${bucket}` : `/${bucket}/${key}`);
  const stamp = new Date(machineMs()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payload = digest(body);
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': stamp };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    path,
    '',
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    names.join(';'),
    payload,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, digest(canonical)].join('\n');
  const signingKey = [day, region, 's3', 'aws4_request'].reduce<Buffer | string>((key2, part) => hmac(key2, part), `AWS4${secretAccessKey}`);
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return fetch(`${endpoint}${path}`, {
    method,
    headers,
    body: method === 'PUT' ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Stores an object and resolves only once storage has confirmed it. */
export async function putObject(key: string, body: Buffer): Promise<void> {
  try {
    const response = await signed('PUT', key, body, 'application/json');
    if (!response.ok) throw new StorageUnavailable(`PUT ${key} answered ${response.status}`);
  } catch (error) {
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable(String(error));
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    return (await signed('HEAD', '', Buffer.alloc(0))).ok;
  } catch {
    return false;
  }
}
