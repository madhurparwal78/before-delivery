import { createHash, createHmac } from 'node:crypto';
import { env } from '../env';

export class StorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Object storage is unreachable.');
    this.name = 'StorageUnavailableError';
    if (cause !== undefined) this.cause = cause;
  }
}

const SERVICE = 's3';
const REQUEST_TIMEOUT_MS = 5000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeQueryValue(value: string): string {
  return encodePathSegment(value);
}

interface SignedRequest {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  key?: string;
  query?: Record<string, string>;
  body?: Buffer;
  contentType?: string;
}

function buildUrl(request: SignedRequest): { url: string; canonicalUri: string; canonicalQuery: string } {
  const endpoint = new URL(env.s3.endpoint);
  const segments = [env.s3.bucket, ...(request.key ? request.key.split('/') : [])];
  const basePath = endpoint.pathname.replace(/\/+$/u, '');
  const canonicalUri = `${basePath}/${segments.map(encodePathSegment).join('/')}`;
  const entries = Object.entries(request.query ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = entries
    .map(([name, value]) => `${encodeQueryValue(name)}=${encodeQueryValue(value)}`)
    .join('&');
  const url = `${endpoint.origin}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  return { url, canonicalUri, canonicalQuery };
}

async function send(request: SignedRequest): Promise<Response> {
  const { url, canonicalUri, canonicalQuery } = buildUrl(request);
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const now = new Date();
  const amzDate = `${now.toISOString().slice(0, 19).replace(/[-:]/gu, '')}Z`;
  const shortDate = amzDate.slice(0, 8);
  const host = new URL(url).host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (request.contentType) headers['content-type'] = request.contentType;

  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = headerNames.join(';');
  const canonicalRequest = [
    request.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${shortDate}/${env.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${env.s3.secretAccessKey}`, shortDate), env.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${env.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    return await fetch(url, {
      method: request.method,
      headers: { ...headers, authorization },
      body: request.method === 'PUT' ? body : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageUnavailableError(error);
  }
}

async function expectOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  await response.arrayBuffer().catch(() => undefined);
  throw new StorageUnavailableError(`storage responded ${response.status}`);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await expectOk(await send({ method: 'PUT', key, body, contentType }));
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send({ method: 'GET', key });
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }
  await expectOk(response);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send({ method: 'DELETE', key });
  if (response.status === 404) return;
  await expectOk(response);
}

export async function listObjectKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const query: Record<string, string> = { 'list-type': '2', prefix };
    if (continuationToken) query['continuation-token'] = continuationToken;
    const response = await expectOk(await send({ method: 'GET', query }));
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/gu)) keys.push(decodeXmlText(match[1]));
    const truncated = /<IsTruncated>true<\/IsTruncated>/u.test(xml);
    continuationToken = truncated
      ? decodeXmlText(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/u.exec(xml)?.[1] ?? '')
      : undefined;
  } while (continuationToken);
  return keys;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&');
}
