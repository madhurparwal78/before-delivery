import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.ts';

export class StorageUnavailable extends Error {}

const sha256Hex = (payload: string | Buffer): string =>
  createHash('sha256').update(payload).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

const encodeKeyPath = (key: string): string =>
  key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

interface SignedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

const sign = (method: string, path: string, body: Buffer | null): SignedRequest => {
  const { endpoint, region, accessKeyId, secretAccessKey, forcePathStyle, bucket } = config.s3;
  const base = new URL(endpoint);
  const url = forcePathStyle
    ? new URL(`/${bucket}${path}`, base)
    : new URL(path, `${base.protocol}//${bucket}.${base.host}`);

  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (body !== null) headers['content-type'] = 'application/json';

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    method,
    url.pathname,
    url.search.replace(/^\?/, ''),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url, method, headers, body: payload };
};

const send = async (
  method: string,
  path: string,
  body: Buffer | null,
): Promise<{ status: number; body: Buffer }> => {
  const signed = sign(method, path, body);
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body === null ? undefined : new Uint8Array(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new StorageUnavailable('MinIO is unreachable');
  }
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
};

export const ensureBucket = async (): Promise<void> => {
  const head = await send('HEAD', '/', null);
  if (head.status === 200) return;
  const created = await send('PUT', '/', null);
  if (created.status >= 400 && created.status !== 409) {
    throw new StorageUnavailable(`Bucket could not be created (${created.status})`);
  }
};

export const putSnapshot = async (key: string, bytes: Buffer): Promise<void> => {
  const response = await send('PUT', `/${encodeKeyPath(key)}`, bytes);
  if (response.status >= 400) {
    throw new StorageUnavailable(`Snapshot write failed (${response.status})`);
  }
};

export const getSnapshot = async (key: string): Promise<Buffer | null> => {
  const response = await send('GET', `/${encodeKeyPath(key)}`, null);
  if (response.status === 404) return null;
  if (response.status >= 400) {
    throw new StorageUnavailable(`Snapshot read failed (${response.status})`);
  }
  return response.body;
};

export const snapshotKey = (gameweek: number, managerId: string): string =>
  `snapshots/gw-${String(gameweek).padStart(2, '0')}/${managerId}.json`;
