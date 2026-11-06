// The MinIO object store over the S3 API, signed with AWS Signature V4.
import { createHash, createHmac } from 'node:crypto';
import { config } from './config.ts';
import { apiError } from './errors.ts';

const CALL_TIMEOUT_MS = 3000;
const OUTAGE_MEMORY_MS = 5000; // the app never remembers an outage for longer than ten seconds
const DELETE_RETRY_MS = 2000;

let unavailableUntil = 0;

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encodeSegment = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

class StorageUnavailable extends Error {}

interface S3Response { status: number; headers: Headers; body: Buffer }

async function call(method: string, key: string, options: { query?: Record<string, string>; body?: Buffer; contentType?: string } = {}): Promise<S3Response> {
  if (Date.now() < unavailableUntil) throw new StorageUnavailable();
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = (forcePathStyle ? `/${encodeSegment(bucket)}` : '') + (key ? '/' + key.split('/').map(encodeSegment).join('/') : forcePathStyle ? '' : '/');
  const query = Object.entries(options.query ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`).join('&');
  const body = options.body ?? Buffer.alloc(0);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': sha256(body), 'x-amz-date': amzDate };
  if (options.contentType) headers['content-type'] = options.contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path || '/', query, names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), headers['x-amz-content-sha256']].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = createHmac('sha256', signingKey).update(`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`).digest('hex');
  const { host: _host, ...sent } = headers;
  sent.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  try {
    const response = await fetch(`${base.protocol}//${host}${path || '/'}${query ? '?' + query : ''}`, {
      method, headers: sent, body: method === 'PUT' ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status >= 500) throw new StorageUnavailable();
    return { status: response.status, headers: response.headers, body: bytes };
  } catch (error) {
    unavailableUntil = Date.now() + OUTAGE_MEMORY_MS;
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable();
  }
}

/** Runs storage work, turning an unreachable store into 503 storage_unavailable. */
export async function orUnavailable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageUnavailable) throw apiError(503, 'storage_unavailable');
    throw error;
  }
}

/** Whether the store answers; the bucket is created on first contact (a fresh store starts empty). */
export async function storageAvailable(): Promise<boolean> {
  try {
    const head = await call('HEAD', '');
    if (head.status === 404) await call('PUT', '');
    return true;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const r = await call('PUT', key, { body, contentType });
  if (r.status !== 200) throw new StorageUnavailable();
}

/** The stored size of a key, or null when it does not exist. */
export async function objectSize(key: string): Promise<number | null> {
  const r = await call('HEAD', key);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new StorageUnavailable();
  return Number(r.headers.get('content-length'));
}

export async function getObject(key: string): Promise<Buffer | null> {
  const r = await call('GET', key);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new StorageUnavailable();
  return r.body;
}

export async function deleteObject(key: string): Promise<void> {
  const r = await call('DELETE', key);
  if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw new StorageUnavailable();
}

const xmlText = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const query: Record<string, string> = { 'list-type': '2', prefix };
    if (token) query['continuation-token'] = token;
    const r = await call('GET', '', { query });
    if (r.status !== 200) throw new StorageUnavailable();
    const xml = r.body.toString('utf8');
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlText(m[1]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(/<NextContinuationToken>([^<]*)</.exec(xml)?.[1] ?? '') || null : null;
  } while (token);
  return keys;
}

/** Deletes keys, retrying in the background until the store answers. */
export function deleteEventually(keys: string[]): void {
  for (const key of keys) {
    const attempt = (): void => {
      deleteObject(key).catch(() => setTimeout(attempt, DELETE_RETRY_MS));
    };
    attempt();
  }
}

/** Deletes every key under a prefix, retrying in the background until the store answers. */
export function deletePrefixEventually(prefix: string): void {
  const attempt = (): void => {
    listKeys(prefix).then((keys) => deleteEventually(keys), () => setTimeout(attempt, DELETE_RETRY_MS));
  };
  attempt();
}
