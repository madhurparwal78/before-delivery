import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 5_000;

export class StorageUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailable';
  }
}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface S3Response {
  status: number;
  bytes: Buffer;
}

async function s3Request(
  method: 'GET' | 'PUT' | 'HEAD',
  objectKey: string | null,
  payload: Buffer = Buffer.alloc(0),
  contentType?: string,
): Promise<S3Response> {
  const endpoint = new URL(config.storage.endpoint);
  const pathSuffix = objectKey === null ? '' : `/${objectKey}`;
  const canonicalPath = config.storage.forcePathStyle
    ? encodePath(`/${config.storage.bucket}${pathSuffix}`)
    : encodePath(pathSuffix.length === 0 ? '/' : pathSuffix);
  const host = config.storage.forcePathStyle
    ? endpoint.host
    : `${config.storage.bucket}.${endpoint.host}`;
  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (contentType) headers['content-type'] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    method,
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.storage.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, date), config.storage.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `${ALGORITHM} Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpoint.protocol}//${host}${canonicalPath}`;
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, bytes };
  } catch (error) {
    throw new StorageUnavailable(`Object storage is unreachable: ${String(error)}`);
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await s3Request('HEAD', null);
  if (head.status === 200) return;
  await s3Request('PUT', null);
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await s3Request('HEAD', key);
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new StorageUnavailable(`Object storage answered ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await s3Request('GET', key);
  if (response.status === 200) return response.bytes;
  if (response.status === 404) return null;
  throw new StorageUnavailable(`Object storage answered ${response.status}`);
}

/** Writes an object once and returns the checksum of the bytes read back. */
export async function putObjectOnce(key: string, payload: Buffer, contentType: string): Promise<string> {
  if (!(await objectExists(key))) {
    const put = await s3Request('PUT', key, payload, contentType);
    if (put.status < 200 || put.status >= 300) {
      throw new StorageUnavailable(`Object storage answered ${put.status} on write`);
    }
  }
  const stored = await getObject(key);
  if (stored === null) {
    throw new StorageUnavailable('Stored object could not be read back');
  }
  return createHash('sha256').update(stored).digest('hex');
}

export function waiverKey(clubSlug: string, eventId: string, registrationId: string): string {
  return `clubs/${clubSlug}/events/${eventId}/waivers/${registrationId}.pdf`;
}

export function resultsKey(clubSlug: string, eventId: string): string {
  return `clubs/${clubSlug}/events/${eventId}/results/final.pdf`;
}
