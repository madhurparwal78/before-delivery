import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

export class StorageUnreachable extends Error {}

const sha256 = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

const encodeKey = (key: string): string =>
  key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

interface Signed {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** AWS Signature Version 4 for a single S3 object request. */
function sign(method: string, key: string, payload: Buffer): Signed {
  const s3 = config().s3;
  const endpoint = new URL(s3.endpoint);
  const path = s3.forcePathStyle
    ? `/${s3.bucket}/${encodeKey(key)}`
    : `/${encodeKey(key)}`;
  const host = s3.forcePathStyle ? endpoint.host : `${s3.bucket}.${endpoint.host}`;

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(payload);

  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${s3.secretAccessKey}`, dateStamp), s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    url: `${endpoint.origin}${path}`,
    headers: {
      Host: host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

const TIMEOUT_MS = 8000;

async function request(
  method: string,
  key: string,
  payload: Buffer,
  contentType?: string,
): Promise<Response> {
  const signed = sign(method, key, payload);
  const headers: Record<string, string> = { ...signed.headers };
  if (contentType !== undefined) headers['Content-Type'] = contentType;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (method === 'PUT') init.body = payload;
    return await fetch(signed.url, init);
  } catch (error) {
    throw new StorageUnreachable(`MinIO is unreachable: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType = 'application/json',
): Promise<void> {
  const response = await request('PUT', key, body, contentType);
  if (!response.ok) {
    throw new StorageUnreachable(`MinIO refused PUT ${key} with ${response.status}`);
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await request('GET', key, Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new StorageUnreachable(`MinIO refused GET ${key} with ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Used to take back what a failed write had already put down. */
export async function deleteObject(key: string): Promise<void> {
  try {
    await request('DELETE', key, Buffer.alloc(0));
  } catch {
    /* the object stays only if storage is down, and the row is never written */
  }
}

interface Manifest {
  readonly kind: string;
  readonly server_id: string;
  readonly object: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly created_at: string;
}

export const manifestBytes = (manifest: Manifest): Buffer =>
  Buffer.from(JSON.stringify(manifest), 'utf8');

export const objectSha = (body: Buffer): string => sha256(body);

const serverPrefix = (serverId: string): string => `servers/${serverId}`;

export const saveKeys = (serverId: string, worldSlug: string, saveId: string) => ({
  snapshot: `${serverPrefix(serverId)}/worlds/${worldSlug}/saves/${saveId}/snapshot.json`,
  manifest: `${serverPrefix(serverId)}/worlds/${worldSlug}/saves/${saveId}/manifest.json`,
});

export const checkpointKeys = (serverId: string, runId: string, n: number) => ({
  snapshot: `${serverPrefix(serverId)}/chapter-runs/${runId}/checkpoints/${n}/snapshot.json`,
  manifest: `${serverPrefix(serverId)}/chapter-runs/${runId}/checkpoints/${n}/manifest.json`,
});

export const resultKeys = (serverId: string, gameId: string) => ({
  result: `${serverPrefix(serverId)}/games/${gameId}/result.json`,
  manifest: `${serverPrefix(serverId)}/games/${gameId}/manifest.json`,
});

export const exportKeys = (serverId: string, exportId: string) => ({
  archive: `${serverPrefix(serverId)}/exports/${exportId}.tar`,
  manifest: `${serverPrefix(serverId)}/exports/${exportId}.manifest.json`,
});
