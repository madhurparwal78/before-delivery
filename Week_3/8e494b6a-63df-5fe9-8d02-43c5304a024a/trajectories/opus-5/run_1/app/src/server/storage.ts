import { createHash, createHmac } from 'node:crypto';
import { storageConfig } from './env.js';

let forcedDown = false;

export function setStorageDown(down: boolean): void {
  forcedDown = down;
}

class StorageDown extends Error {}

export function isStorageDown(cause: unknown): boolean {
  return cause instanceof StorageDown;
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(): { stamp: string; date: string } {
  const iso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp: iso, date: iso.slice(0, 8) };
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function request(
  method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
  key: string,
  body: Buffer = Buffer.alloc(0),
): Promise<{ status: number; body: Buffer; headers: Headers }> {
  if (forcedDown) throw new StorageDown('storage down');
  const base = new URL(storageConfig.endpoint);
  const path = storageConfig.pathStyle
    ? `/${storageConfig.bucket}/${encodePath(key)}`
    : `/${encodePath(key)}`;
  const host = storageConfig.pathStyle
    ? base.host
    : `${storageConfig.bucket}.${base.host}`;
  const { stamp, date } = amzDate();
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (method === 'PUT') headers['content-length'] = String(body.length);
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${storageConfig.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${storageConfig.secretAccessKey}`, date), storageConfig.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${storageConfig.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

  const url = `${base.protocol}//${base.host}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...headers, authorization },
      body: method === 'PUT' ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new StorageDown('storage unreachable');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (response.status >= 500) throw new StorageDown(`storage status ${response.status}`);
  return { status: response.status, body: buffer, headers: response.headers };
}

export async function ensureBucket(): Promise<void> {
  const base = new URL(storageConfig.endpoint);
  const { stamp, date } = amzDate();
  const payloadHash = sha256Hex('');
  const host = base.host;
  const path = `/${storageConfig.bucket}`;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  const signedHeaders = Object.keys(headers).sort();
  const canonicalRequest = [
    'PUT',
    path,
    '',
    signedHeaders.map((name) => `${name}:${headers[name]}\n`).join(''),
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${storageConfig.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${storageConfig.secretAccessKey}`, date), storageConfig.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  await fetch(`${base.protocol}//${host}${path}`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${storageConfig.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
    },
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}

/** Writes an object and confirms the store reports the same byte size. */
export async function putObject(key: string, body: Buffer): Promise<number> {
  const put = await request('PUT', key, body);
  if (put.status >= 300) throw new StorageDown(`put failed ${put.status}`);
  const head = await request('HEAD', key);
  if (head.status >= 300) throw new StorageDown(`head failed ${head.status}`);
  const size = Number(head.headers.get('content-length') ?? '-1');
  if (size !== body.length) throw new StorageDown('byte size mismatch');
  return size;
}

export async function getObject(key: string): Promise<Buffer> {
  const got = await request('GET', key);
  if (got.status >= 300) throw new StorageDown(`get failed ${got.status}`);
  return got.body;
}

export async function deleteObject(key: string): Promise<void> {
  const gone = await request('DELETE', key);
  if (gone.status >= 300 && gone.status !== 404) throw new StorageDown(`delete failed ${gone.status}`);
}

export async function storageAnswers(): Promise<boolean> {
  if (forcedDown) return false;
  try {
    const probe = await request('HEAD', 'health-probe');
    return probe.status < 500;
  } catch {
    return false;
  }
}

export function uploadKey(spaceSlug: string, sha256: string): string {
  return `uploads/${spaceSlug}/${sha256}.ndjson`;
}

export function segmentKey(spaceSlug: string, stream: string, generation: number): string {
  return `segments/${spaceSlug}/${stream}/${generation}.ndjson`;
}
