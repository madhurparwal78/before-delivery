import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { config } from './env.js';

const SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function sha256(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface SignedRequest {
  method: 'PUT' | 'GET' | 'HEAD';
  key: string;
  body?: Buffer;
  contentType?: string;
}

interface StorageResponse {
  status: number;
  body: Buffer;
}

/** The object's URL and canonical path, honouring path-style addressing. */
function objectLocation(key: string): { url: URL; canonicalPath: string } {
  const endpoint = new URL(config.storage.endpoint);
  if (config.storage.forcePathStyle) {
    const path = key === '' ? `/${config.storage.bucket}` : `/${config.storage.bucket}/${key}`;
    return { url: new URL(encodePath(path), endpoint), canonicalPath: encodePath(path) };
  }
  endpoint.hostname = `${config.storage.bucket}.${endpoint.hostname}`;
  const path = key === '' ? '/' : `/${key}`;
  return { url: new URL(encodePath(path), endpoint), canonicalPath: encodePath(path) };
}

/** Signs a request with AWS Signature Version 4 and sends it to object storage. */
async function send(signed: SignedRequest, timeoutMs: number): Promise<StorageResponse> {
  const { url, canonicalPath } = objectLocation(signed.key);
  const body = signed.body ?? Buffer.alloc(0);
  const payloadHash = signed.body ? sha256(body) : EMPTY_SHA256;
  const { stamp, date } = amzDate(new Date());

  const headers: Record<string, string> = {
    host: url.port === '' ? url.hostname : `${url.hostname}:${url.port}`,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (signed.contentType !== undefined) headers['content-type'] = signed.contentType;
  if (signed.method === 'PUT') headers['content-length'] = String(body.length);

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    signed.method,
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.storage.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, date), config.storage.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<StorageResponse>((resolve, reject) => {
    const outgoing = transport(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: signed.method,
        headers,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
        response.on('error', reject);
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error('Object storage timed out')));
    outgoing.on('error', reject);
    if (signed.body) outgoing.write(body);
    outgoing.end();
  });
}

export function exportKey(diagramId: string, exportId: string, format: 'png' | 'svg'): string {
  return `exports/${diagramId}/${exportId}.${format}`;
}

/** Each call opens a fresh attempt, so storage works again as soon as it is back. */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  timeoutMs: number,
): Promise<void> {
  await ensureBucket(timeoutMs);
  const response = await send({ method: 'PUT', key, body, contentType }, timeoutMs);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Object storage refused the write with status ${response.status}`);
  }
}

/** Confirms the object exists before an export may become ready. */
export async function objectExists(key: string, timeoutMs: number): Promise<boolean> {
  const response = await send({ method: 'HEAD', key }, timeoutMs);
  return response.status >= 200 && response.status < 300;
}

export async function getObject(key: string, timeoutMs: number): Promise<Buffer> {
  const response = await send({ method: 'GET', key }, timeoutMs);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Object storage refused the read with status ${response.status}`);
  }
  return response.body;
}

let bucketReady = false;

async function ensureBucket(timeoutMs: number): Promise<void> {
  if (bucketReady) return;
  const probe = await send({ method: 'HEAD', key: '' }, timeoutMs);
  if (probe.status === 404) {
    const created = await send({ method: 'PUT', key: '', body: Buffer.alloc(0) }, timeoutMs);
    if (created.status < 200 || created.status >= 300) {
      throw new Error(`Object storage refused to create the bucket (status ${created.status})`);
    }
  } else if (probe.status >= 400 && probe.status !== 403) {
    throw new Error(`Object storage is unavailable (status ${probe.status})`);
  }
  bucketReady = true;
}
