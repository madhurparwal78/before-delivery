import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

/** MinIO object storage over the S3 REST API, signed with AWS Signature V4. */

export class StorageUnreachable extends Error {}

const SERVICE = 's3';

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

interface SignedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Buffer | undefined;
}

function signRequest(method: string, path: string, body: Buffer | undefined): SignedRequest {
  const settings = config().s3;
  const endpoint = new URL(settings.endpoint);
  const canonicalUri = path
    .split('/')
    .map((segment) => (segment === '' ? '' : encodeSegment(segment)))
    .join('/');
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const amzDate = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const host = endpoint.host;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${settings.region}/${SERVICE}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${settings.secretAccessKey}`, dateStamp), settings.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign, 'utf8').digest('hex');
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (body !== undefined) headers['content-length'] = String(body.length);
  return { url: `${endpoint.origin}${canonicalUri}`, method, headers, body };
}

async function send(
  method: string,
  path: string,
  body: Buffer | undefined,
): Promise<{ status: number; bytes: Buffer }> {
  const signed = signRequest(method, path, body);
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: signed.body === undefined ? undefined : new Uint8Array(signed.body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new StorageUnreachable('MinIO is unreachable');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes };
}

function objectPath(key: string): string {
  const settings = config().s3;
  return settings.forcePathStyle ? `/${settings.bucket}/${key}` : `/${key}`;
}

export async function ensureBucket(): Promise<void> {
  const settings = config().s3;
  const head = await send('HEAD', `/${settings.bucket}`, undefined);
  if (head.status === 200) return;
  const made = await send('PUT', `/${settings.bucket}`, Buffer.alloc(0));
  if (made.status >= 300 && made.status !== 409) {
    throw new StorageUnreachable(`The bucket could not be created (${made.status})`);
  }
}

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  const result = await send('PUT', objectPath(key), bytes);
  if (result.status >= 300) throw new StorageUnreachable(`Storing ${key} answered ${result.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const result = await send('GET', objectPath(key), undefined);
  if (result.status >= 300) throw new StorageUnreachable(`Reading ${key} answered ${result.status}`);
  return result.bytes;
}

export async function deleteObject(key: string): Promise<void> {
  const result = await send('DELETE', objectPath(key), undefined);
  if (result.status >= 300 && result.status !== 404) {
    throw new StorageUnreachable(`Deleting ${key} answered ${result.status}`);
  }
}
