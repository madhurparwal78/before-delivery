import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

export class ReportStoreUnavailable extends Error {}

function hash(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; day: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, day: stamp.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

interface S3Request {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  key?: string;
  body?: Buffer;
  contentType?: string;
  bucketOnly?: boolean;
}

async function send(request: S3Request): Promise<{ status: number; body: Buffer }> {
  const endpoint = new URL(config.s3.endpoint);
  const basePath = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${request.key ? `/${encodePath(request.key)}` : ''}`
    : `${request.key ? `/${encodePath(request.key)}` : '/'}`;
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = hash(body);
  const { stamp, day } = amzDate(new Date());
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  if (request.contentType) headers['content-type'] = request.contentType;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    request.method,
    basePath,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `${endpoint.protocol}//${endpoint.host}${basePath}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ReportStoreUnavailable('object store unreachable');
  }
  const responseBody = Buffer.from(await response.arrayBuffer());
  if (response.status >= 500) throw new ReportStoreUnavailable(`object store error ${response.status}`);
  return { status: response.status, body: responseBody };
}

export async function ensureBucket(): Promise<void> {
  const head = await send({ method: 'HEAD', bucketOnly: true });
  if (head.status === 404) {
    await send({ method: 'PUT', bucketOnly: true });
  }
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const result = await send({ method: 'PUT', key, body: bytes, contentType });
  if (result.status >= 300) throw new ReportStoreUnavailable(`put failed ${result.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const result = await send({ method: 'GET', key });
  if (result.status === 404) return null;
  if (result.status >= 300) throw new ReportStoreUnavailable(`get failed ${result.status}`);
  return result.body;
}

/** Confirms the stored object is there, so a draw only turns Ready once MinIO has it. */
export async function objectExists(key: string): Promise<boolean> {
  const result = await send({ method: 'HEAD', key });
  if (result.status === 404) return false;
  if (result.status >= 300) throw new ReportStoreUnavailable(`head failed ${result.status}`);
  return true;
}

export async function deleteObject(key: string): Promise<void> {
  const result = await send({ method: 'DELETE', key });
  if (result.status >= 300 && result.status !== 404) {
    throw new ReportStoreUnavailable(`delete failed ${result.status}`);
  }
}

export function reportKey(memberId: string, drawId: string): string {
  return `members/${memberId}/draws/${drawId}/report.pdf`;
}

export function attachmentOriginalKey(memberId: string, attachmentId: string): string {
  return `members/${memberId}/attachments/${attachmentId}/original`;
}

export function attachmentCleanKey(memberId: string, attachmentId: string): string {
  return `members/${memberId}/attachments/${attachmentId}/clean`;
}
