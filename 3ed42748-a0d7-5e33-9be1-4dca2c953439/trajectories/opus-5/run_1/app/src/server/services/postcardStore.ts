import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { fail } from '../http/errors.js';
import { ServiceGate } from './availability.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 3000;

function hex(value: Buffer): string {
  return value.toString('hex');
}

function sha256(value: Buffer | string): Buffer {
  return createHash('sha256').update(value).digest();
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function stamps(now: Date): { amzDate: string; day: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { amzDate, day: amzDate.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface StoreRequest {
  method: 'PUT' | 'GET' | 'DELETE' | 'HEAD';
  key?: string;
  query?: Record<string, string>;
  body?: Buffer;
  contentType?: string;
}

function canonicalQuery(query: Record<string, string> | undefined): string {
  if (query === undefined) return '';
  return Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name]!)}`)
    .join('&');
}

interface StoreResponse {
  status: number;
  bytes: Buffer;
}

/** A signed request to the bucket, built by hand so no credential ever leaves this module. */
async function send(request: StoreRequest): Promise<StoreResponse> {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${request.key === undefined ? '' : `/${request.key}`}`
    : `/${request.key ?? ''}`;
  const canonicalUri = encodePath(path);
  const search = canonicalQuery(request.query);
  const payload = request.body ?? Buffer.alloc(0);
  const payloadHash = hex(sha256(payload));
  const { amzDate, day } = stamps(new Date());
  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (request.contentType !== undefined) headers['content-type'] = request.contentType;
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [
    request.method,
    canonicalUri,
    search,
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, hex(sha256(canonicalRequest))].join('\n');
  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hex(hmac(signingKey, stringToSign));
  const authorization = `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

  const response = await fetch(
    `${endpoint.origin}${canonicalUri}${search === '' ? '' : `?${search}`}`,
    {
      method: request.method,
      headers: { ...headers, authorization },
      body: request.method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes };
}

const objectKey = (postcardId: string): string => `postcards/${postcardId}.png`;

async function requireOk(request: StoreRequest, allowMissing = false): Promise<StoreResponse> {
  const response = await send(request);
  if (response.status >= 200 && response.status < 300) return response;
  if (response.status === 404) {
    if (allowMissing) return response;
    throw fail('not_found');
  }
  throw new Error('store refused the request');
}

export const darkroom = new ServiceGate('darkroom_closed', async () => {
  await requireOk({ method: 'GET', query: { 'list-type': '2', 'max-keys': '0' } });
});

export async function putPostcardImage(postcardId: string, bytes: Buffer): Promise<void> {
  await darkroom.use(async () => {
    await requireOk({
      method: 'PUT',
      key: objectKey(postcardId),
      body: bytes,
      contentType: 'image/png',
    });
  });
}

export async function getPostcardImage(postcardId: string): Promise<Buffer> {
  return darkroom.use(async () => {
    const response = await requireOk({ method: 'GET', key: objectKey(postcardId) });
    return response.bytes;
  });
}

export async function deletePostcardImage(postcardId: string): Promise<void> {
  await darkroom.use(async () => {
    await requireOk({ method: 'DELETE', key: objectKey(postcardId) }, true);
  });
}

export interface StoredImage {
  postcardId: string;
  lastModified: Date;
}

/** Lists stored images, so any left without a record can be cleaned away. */
export async function listPostcardImages(): Promise<StoredImage[]> {
  return darkroom.use(async () => {
    const response = await requireOk({
      method: 'GET',
      query: { 'list-type': '2', 'max-keys': '1000', prefix: 'postcards/' },
    });
    const xml = response.bytes.toString('utf8');
    const stored: StoredImage[] = [];
    const pattern = /<Key>postcards\/(pc_[a-z0-9]+)\.png<\/Key>\s*<LastModified>([^<]+)<\/LastModified>/g;
    for (const match of xml.matchAll(pattern)) {
      stored.push({ postcardId: match[1]!, lastModified: new Date(match[2]!) });
    }
    return stored;
  });
}
