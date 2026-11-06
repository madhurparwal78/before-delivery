import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { config } from '../config';

export const STORAGE_TIMEOUT_MS = 3000;

export class StorageUnavailable extends Error {
  constructor(message: string) {
    super(message);
  }
}

type S3Response = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };

function sign(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function hashHex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function amzDate(now: Date): { stamp: string; date: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp: iso, date: iso.slice(0, 8) };
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function send(
  method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
  key: string,
  options: { body?: Buffer; contentType?: string; queryString?: string } = {},
): Promise<S3Response> {
  const endpoint = new URL(config.s3Endpoint);
  const secure = endpoint.protocol === 'https:';
  const basePath = config.s3ForcePathStyle ? `/${config.s3Bucket}` : '';
  const path = `${basePath}${key === '' ? '/' : `/${encodeKeyPath(key)}`}`;
  const search = options.queryString === undefined ? '' : `?${options.queryString}`;
  const body = options.body ?? Buffer.alloc(0);
  const payloadHash = hashHex(body);
  const now = new Date();
  const { stamp, date } = amzDate(now);
  const host = endpoint.host;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  if (method === 'PUT') headers['content-length'] = String(body.length);
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalQuery = options.queryString ?? '';
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3Region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, hashHex(canonicalRequest)].join('\n');
  const dateKey = sign(`AWS4${config.s3SecretAccessKey}`, date);
  const regionKey = sign(dateKey, config.s3Region);
  const serviceKey = sign(regionKey, 's3');
  const signingKey = sign(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers['authorization'] = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise<S3Response>((resolve, reject) => {
    const doRequest = secure ? httpsRequest : httpRequest;
    const req = doRequest(
      {
        host: endpoint.hostname,
        port: endpoint.port === '' ? (secure ? 443 : 80) : Number(endpoint.port),
        method,
        path: `${path}${search}`,
        headers,
        timeout: STORAGE_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new StorageUnavailable('storage timed out'));
    });
    req.on('error', (error) => reject(new StorageUnavailable(error.message)));
    if (body.length > 0) req.write(body);
    req.end();
  });
}

async function call(
  method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
  key: string,
  options: { body?: Buffer; contentType?: string; queryString?: string } = {},
): Promise<S3Response> {
  try {
    const response = await send(method, key, options);
    if (response.status >= 500) {
      throw new StorageUnavailable(`storage answered ${response.status}`);
    }
    return response;
  } catch (error) {
    // An outage is never remembered: the next call tries the store again.
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable((error as Error).message);
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    const head = await send('HEAD', '');
    if (head.status === 404) await send('PUT', '');
  } catch {
    // The app starts even when the object store is unreachable.
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await call('PUT', key, { body, contentType });
  if (response.status >= 300) throw new StorageUnavailable(`put answered ${response.status}`);
}

export async function headObjectSize(key: string): Promise<number | null> {
  const response = await call('HEAD', key);
  if (response.status === 404) return null;
  if (response.status >= 300) throw new StorageUnavailable(`head answered ${response.status}`);
  const length = response.headers['content-length'];
  const value = Array.isArray(length) ? length[0] : length;
  return value === undefined ? null : Number(value);
}

export async function getObject(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const response = await call('GET', key);
  if (response.status === 404) return null;
  if (response.status >= 300) throw new StorageUnavailable(`get answered ${response.status}`);
  const type = response.headers['content-type'];
  const contentType = Array.isArray(type) ? type[0] : type ?? 'application/octet-stream';
  return { bytes: response.body, contentType };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await call('DELETE', key);
  if (response.status >= 300 && response.status !== 404) {
    throw new StorageUnavailable(`delete answered ${response.status}`);
  }
}

export async function listKeys(prefix: string): Promise<string[]> {
  const response = await call('GET', '', {
    queryString: `list-type=2&prefix=${encodeURIComponent(prefix).replace(/%2F/g, '%2F')}`,
  });
  if (response.status >= 300) throw new StorageUnavailable(`list answered ${response.status}`);
  const text = response.body.toString('utf8');
  const keys: string[] = [];
  const re = /<Key>([^<]*)<\/Key>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    keys.push(match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  return keys;
}

/** Keep deleting until the store answers. */
export async function deleteObjectEventually(key: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await deleteObject(key);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function probeStorage(): Promise<boolean> {
  try {
    await call('HEAD', '');
    return true;
  } catch {
    return false;
  }
}

export function attachmentKey(objectId: string, attachmentId: string): string {
  return `attachments/${objectId}/${attachmentId}`;
}

export function shareCacheKey(shareLinkId: string, objectId: string): string {
  return `share-cache/${shareLinkId}/${objectId}.html`;
}

export function shareCachePrefix(shareLinkId: string): string {
  return `share-cache/${shareLinkId}/`;
}
