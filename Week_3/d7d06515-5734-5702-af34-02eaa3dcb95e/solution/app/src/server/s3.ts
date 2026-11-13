// MinIO over hand-signed (SigV4) fetch calls. An object counts as stored only when a HEAD confirms its size.
import { createHash, createHmac } from 'node:crypto';
import { config } from './config.ts';

export class StorageUnavailable extends Error {
  constructor() {
    super('storage_unavailable');
  }
}

const TIMEOUT_MS = 5000;
const EMPTY_HASH = createHash('sha256').update('').digest('hex');

const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string): { url: URL; canonicalPath: string } {
  const endpoint = new URL(config.s3.endpoint);
  const path = key ? `/${key.split('/').map(encodeSegment).join('/')}` : '/';
  if (config.s3.forcePathStyle) {
    const canonicalPath = `/${encodeSegment(config.s3.bucket)}${key ? path : ''}`;
    return { url: new URL(canonicalPath, endpoint), canonicalPath };
  }
  const url = new URL(path, `${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}`);
  return { url, canonicalPath: path };
}

async function send(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const { url, canonicalPath } = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = body ? sha256(body) : EMPTY_HASH;
  const amzHeaders = { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = ['host', ...Object.keys(amzHeaders)].join(';');
  const canonicalHeaders = `host:${url.host}\n${Object.entries(amzHeaders).map(([k, v]) => `${k}:${v}\n`).join('')}`;
  const canonicalRequest = [method, canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return fetch(url, {
    method,
    headers: {
      ...amzHeaders,
      ...(contentType ? { 'content-type': contentType } : {}),
      authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** PUT, then HEAD and compare the size: only a confirmed object resolves. */
export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  try {
    const put = await send('PUT', key, bytes, contentType);
    await put.arrayBuffer();
    if (!put.ok) throw new StorageUnavailable();
    const head = await send('HEAD', key);
    if (!head.ok || Number(head.headers.get('content-length')) !== bytes.length) throw new StorageUnavailable();
  } catch (error) {
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable();
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    const response = await send('GET', key);
    if (!response.ok) throw new StorageUnavailable();
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable();
  }
}

/** Resolves when the bucket answers; creates it when MinIO reports it missing. Throws otherwise. */
export async function checkStorage(): Promise<void> {
  const head = await send('HEAD', '');
  if (head.ok) return;
  if (head.status !== 404) throw new StorageUnavailable();
  const body = config.s3.region === 'us-east-1' ? undefined : Buffer.from(
    `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${config.s3.region}</LocationConstraint></CreateBucketConfiguration>`,
  );
  const created = await send('PUT', '', body);
  await created.arrayBuffer();
  if (!created.ok) throw new StorageUnavailable();
}
