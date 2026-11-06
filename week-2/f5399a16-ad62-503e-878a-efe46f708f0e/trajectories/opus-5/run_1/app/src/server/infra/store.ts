import { createHash, createHmac } from 'node:crypto';
import { config, PROVIDER_TIMEOUT_MS } from '../config.js';

export class StoreDown extends Error {}

const EMPTY_SHA = createHash('sha256').update('').digest('hex');

function sign(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

type StoreRequest = {
  method: 'PUT' | 'GET' | 'DELETE' | 'HEAD';
  key?: string;
  body?: Buffer;
  contentType?: string;
};

async function call(request: StoreRequest): Promise<Response> {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const path =
    request.key === undefined ? `/${bucket}` : `/${bucket}/${encodeKeyPath(request.key)}`;
  const url = new URL(path, base);
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = request.body ? createHash('sha256').update(body).digest('hex') : EMPTY_SHA;
  const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const day = stamp.slice(0, 8);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (request.contentType !== undefined) headers['content-type'] = request.contentType;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [
    request.method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signature = sign(
    sign(sign(sign(sign(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request'),
    toSign,
  ).toString('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(
      ';',
    )}, Signature=${signature}`;

  try {
    return await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'PUT' ? body : undefined,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new StoreDown('file store unreachable');
  }
}

/** The app makes its bucket when it is missing and MinIO is reachable. */
export async function ensureBucket(): Promise<void> {
  const head = await call({ method: 'HEAD' });
  if (head.ok) return;
  const made = await call({ method: 'PUT' });
  if (!made.ok && made.status !== 409) throw new StoreDown(`bucket refused ${made.status}`);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await call({ method: 'PUT', key, body, contentType });
  if (!response.ok) throw new StoreDown(`put refused ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await call({ method: 'GET', key });
  if (response.status === 404) return null;
  if (!response.ok) throw new StoreDown(`get refused ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call({ method: 'DELETE', key });
  if (!response.ok && response.status !== 404) {
    throw new StoreDown(`delete refused ${response.status}`);
  }
}

/** Stored, Ready and Erased show only after MinIO has confirmed. */
export async function objectExists(key: string): Promise<boolean> {
  const response = await call({ method: 'HEAD', key });
  if (response.status === 404) return false;
  if (!response.ok) throw new StoreDown(`head refused ${response.status}`);
  return true;
}

export const storeKeys = {
  frame: (clientId: string, jobId: string, sha256: string): string =>
    `clients/${clientId}/jobs/${jobId}/frames/${sha256}`,
  attachment: (clientId: string, jobId: string, id: string): string =>
    `clients/${clientId}/jobs/${jobId}/attachments/${id}`,
  film: (clientId: string, jobId: string, renderId: string): string =>
    `clients/${clientId}/jobs/${jobId}/films/${renderId}`,
  packageFile: (clientId: string, jobId: string, packageId: string, fileName: string): string =>
    `clients/${clientId}/jobs/${jobId}/packages/${packageId}/${fileName}`,
  letter: (clientId: string, jobId: string, letterId: string): string =>
    `clients/${clientId}/jobs/${jobId}/letters/${letterId}/fee-letter.pdf`,
};
