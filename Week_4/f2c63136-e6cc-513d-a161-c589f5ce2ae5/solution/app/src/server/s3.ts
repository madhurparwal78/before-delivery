import { createHash, createHmac } from 'node:crypto';
import { config } from './config.ts';
import { StorageDown } from './errors.ts';

const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
const host = new URL(endpoint).host;
const TIMEOUT_MS = 4000;

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

function encodeKey(key: string): string {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function request(method: string, key: string, body?: Buffer): Promise<{ status: number; body: Buffer }> {
  const path = `/${bucket}${key ? `/${encodeKey(key)}` : ''}`;
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payload = sha256(body ?? '');
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payload, 'x-amz-date': stamp };
  const signed = Object.keys(headers).sort().join(';');
  const canonical = [method, path, '', Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join(''), signed, payload].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${hmac(signingKey, toSign).toString('hex')}`;
  try {
    const response = await fetch(`${endpoint}${path}`, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
  } catch {
    throw new StorageDown();
  }
}

const contentKey = (sha: string): string => `objects/${sha}`;

/** Stores the bytes exactly as given under their SHA-256 and returns it. */
export async function putContent(bytes: Buffer): Promise<string> {
  const sha = sha256(bytes);
  const result = await request('PUT', contentKey(sha), bytes);
  if (result.status !== 200) throw new StorageDown();
  return sha;
}

export async function getContent(sha: string): Promise<Buffer> {
  const result = await request('GET', contentKey(sha));
  if (result.status !== 200) throw new StorageDown();
  return result.body;
}

export async function putArchive(key: string, bytes: Buffer): Promise<void> {
  const result = await request('PUT', key, bytes);
  if (result.status !== 200) throw new StorageDown();
}

export async function storageReachable(): Promise<boolean> {
  try {
    return (await request('HEAD', '')).status === 200;
  } catch {
    return false;
  }
}

export { sha256 };
