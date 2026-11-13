import { createHmac } from 'node:crypto';
import type { Config } from './config.ts';
import { sha256 } from './digest.ts';
import { storageUnavailable } from './errors.ts';

type StorageState = 'up' | 'down';

const OPERATION_MS = 8000;
const PROBE_MS = 2000;

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encode = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The one seam to MinIO: signed requests for the attachment objects. Every failure is a 503 for the caller,
 * and the state it reports is refreshed by a probe every two seconds, so an outage and its recovery are seen
 * without a restart.
 */
let settings: Config['s3'];
let state: StorageState = 'down';

/** Where an attachment's bytes live in the bucket. */
export const objectKey = (workspaceId: string, cardId: string, attachmentId: string): string =>
  `attachments/${workspaceId}/${cardId}/${attachmentId}`;

export function startStorage(config: Config['s3']): void {
  settings = config;
  void probe();
  setInterval(() => void probe(), PROBE_MS).unref();
}

export const storageState = (): StorageState => state;

async function request(
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
  key: string,
  body: Buffer = Buffer.alloc(0),
  contentType?: string,
): Promise<Response> {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey, forcePathStyle } = settings;
  const base = new URL(endpoint);
  // Path style (`host/bucket/key`) or, when the endpoint asks for it, virtual-hosted style (`bucket.host/key`).
  const url = new URL(forcePathStyle ? base.origin : `${base.protocol}//${bucket}.${base.host}`);
  const objectPath = key ? `/${key.split('/').map(encode).join('/')}` : '';
  const path = forcePathStyle ? `/${encode(bucket)}${objectPath}` : objectPath || '/';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payload = sha256(body);
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, '', ...names.map((name) => `${name}:${headers[name]}`), '', names.join(';'), payload].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  delete headers['host'];
  return fetch(`${url.origin}${path}`, {
    method,
    headers,
    ...(method === 'PUT' ? { body: new Uint8Array(body) } : {}),
    signal: AbortSignal.timeout(OPERATION_MS),
  });
}

/** Every operation is idempotent, so a failure is tried once more before storage counts as down. */
async function attempt<T>(work: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      const result = await work();
      state = 'up';
      return result;
    } catch {
      if (tries < 2) continue;
      state = 'down';
      throw storageUnavailable();
    }
  }
}

async function probe(): Promise<void> {
  try {
    const response = await request('HEAD', '');
    state = response.ok ? 'up' : 'down';
  } catch {
    state = 'down';
  }
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await attempt(async () => {
    const response = await request('PUT', key, bytes, contentType);
    if (!response.ok) throw new Error('put refused');
  });
}

/** The stored size of an object, read back after writing it. */
export async function objectSize(key: string): Promise<number> {
  return attempt(async () => {
    const response = await request('HEAD', key);
    if (!response.ok) throw new Error('head refused');
    return Number(response.headers.get('content-length'));
  });
}

export async function getObject(key: string): Promise<{ bytes: Buffer; contentType: string }> {
  return attempt(async () => {
    const response = await request('GET', key);
    if (!response.ok) throw new Error('get refused');
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  });
}

export async function removeObject(key: string): Promise<void> {
  await attempt(async () => {
    const response = await request('DELETE', key);
    if (!response.ok) throw new Error('delete refused');
  });
}
