import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.ts';
import { storageUnavailable } from '../errors.ts';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const POSITIVE_CACHE_MS = 10_000;

const presentObjects = new Map<string, number>();

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

type SignedRequest = {
  url: string;
  headers: Record<string, string>;
};

function signRequest(method: string, objectPath: string, body: Buffer, contentType?: string): SignedRequest {
  const endpoint = new URL(config.storage.endpoint);
  const basePath = config.storage.forcePathStyle ? `/${config.storage.bucket}` : '';
  const canonicalUri = `${basePath}${objectPath === '' ? '/' : encodePath(objectPath)}`;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const host = endpoint.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType !== undefined) headers['content-type'] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${config.storage.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, dateStamp), config.storage.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] = `${ALGORITHM} Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${endpoint.origin}${canonicalUri}`, headers };
}

async function send(
  method: string,
  objectPath: string,
  body: Buffer = Buffer.alloc(0),
  contentType?: string,
): Promise<Response> {
  const signed = signRequest(method, objectPath, body, contentType);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw storageUnavailable();
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', '');
  if (head.status === 404) {
    const made = await send('PUT', '');
    if (!made.ok && made.status !== 409) throw storageUnavailable();
    return;
  }
  if (!head.ok) throw storageUnavailable();
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', `/${key}`, body, contentType);
  if (!response.ok) throw storageUnavailable();
  presentObjects.set(key, Date.now());
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', `/${key}`);
  if (response.status === 404) return null;
  if (!response.ok) throw storageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', `/${key}`);
  if (!response.ok && response.status !== 404) throw storageUnavailable();
  presentObjects.delete(key);
}

/** A present object may be remembered for ten seconds; a missing one or a failure never is. */
export async function objectIsPresent(key: string): Promise<boolean> {
  const seen = presentObjects.get(key);
  if (seen !== undefined && Date.now() - seen < POSITIVE_CACHE_MS) return true;
  const response = await send('HEAD', `/${key}`);
  if (response.ok) {
    presentObjects.set(key, Date.now());
    return true;
  }
  if (response.status === 404) {
    presentObjects.delete(key);
    return false;
  }
  throw storageUnavailable();
}

export async function storageIsReachable(): Promise<boolean> {
  try {
    const response = await send('HEAD', '');
    return response.ok;
  } catch {
    return false;
  }
}
