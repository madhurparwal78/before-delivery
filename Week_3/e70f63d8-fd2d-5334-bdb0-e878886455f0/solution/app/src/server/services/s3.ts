import { createHash, createHmac } from 'node:crypto';
import { config, SERVICE_PING_MS } from '../config.js';

const REQUEST_TIMEOUT_MS = 8_000;
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export class StorageUnavailable extends Error {}

const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface Target { url: string; host: string; path: string }

const targetOf = (key: string): Target => {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = key === '' ? '' : `/${key.split('/').map(encodeSegment).join('/')}`;
  if (config.s3.forcePathStyle) {
    const path = `/${encodeSegment(config.s3.bucket)}${objectPath}`;
    return { url: `${endpoint.origin}${path}`, host: endpoint.host, path };
  }
  const host = `${config.s3.bucket}.${endpoint.host}`;
  return { url: `${endpoint.protocol}//${host}${objectPath || '/'}`, host, path: objectPath || '/' };
};

/** One request signed with AWS Signature V4 against the configured endpoint. */
const send = async (method: string, key: string, body: Uint8Array<ArrayBuffer> | undefined, contentType: string | undefined, timeoutMs: number): Promise<Response> => {
  const target = targetOf(key);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payloadHash = body ? sha256(body) : EMPTY_SHA256;
  const headers: Record<string, string> = { host: target.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, target.path, '', ...names.map((name) => `${name}:${headers[name]}`), '', names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  let signingKey: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers['authorization'] = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  const { host: _host, ...sendable } = headers;
  return fetch(target.url, { method, headers: sendable, body, signal: AbortSignal.timeout(timeoutMs) });
};

const attempt = async (work: () => Promise<Response>): Promise<Response> => {
  try {
    return await work();
  } catch {
    throw new StorageUnavailable('storage is unreachable');
  }
};

let bucketReady = false;

const ensureBucket = async (): Promise<void> => {
  if (bucketReady) return;
  const head = await attempt(() => send('HEAD', '', undefined, undefined, REQUEST_TIMEOUT_MS));
  if (head.status === 404) {
    const created = await attempt(() => send('PUT', '', undefined, undefined, REQUEST_TIMEOUT_MS));
    if (!created.ok) throw new StorageUnavailable('the bucket cannot be created');
  } else if (!head.ok) {
    throw new StorageUnavailable('the bucket cannot be read');
  }
  bucketReady = true;
};

/** Creates the bucket when it is missing; storage being down at boot only means the next upload tries again. */
export const prepareStorage = (): void => {
  ensureBucket().catch(() => undefined);
};

export const putObject = async (key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<void> => {
  await ensureBucket();
  const response = await attempt(() => send('PUT', key, body, contentType, REQUEST_TIMEOUT_MS));
  if (!response.ok) throw new StorageUnavailable(`the object was not stored (${response.status})`);
};

export const getObject = async (key: string): Promise<{ body: Buffer; contentType: string }> => {
  const response = await attempt(() => send('GET', key, undefined, undefined, REQUEST_TIMEOUT_MS));
  if (!response.ok) throw new StorageUnavailable(`the object cannot be read (${response.status})`);
  return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
};

export const pingStorage = async (): Promise<boolean> => {
  try {
    return (await send('HEAD', '', undefined, undefined, SERVICE_PING_MS)).status < 500;
  } catch {
    return false;
  }
};
