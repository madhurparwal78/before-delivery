import { createHash, createHmac } from 'node:crypto';
import { env } from '../env';

export class StorageUnreachable extends Error {
  constructor(cause: string) {
    super(`Photo storage is unreachable: ${cause}`);
    process.stderr.write(`${this.message}\n`);
  }
}

const SERVICE = 's3';
const UNSIGNED_SEGMENT = /[^A-Za-z0-9\-._~]/g;

function encodeSegment(segment: string): string {
  return segment.replace(UNSIGNED_SEGMENT, (character) => {
    const bytes = Buffer.from(character, 'utf8');
    let encoded = '';
    for (const byte of bytes) encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    return encoded;
  });
}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; day: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, day: stamp.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

function signRequest(
  method: string,
  canonicalPath: string,
  canonicalQuery: string,
  headers: Record<string, string>,
  body: Buffer,
): SignedRequest {
  const { stamp, day } = amzDate(new Date());
  const host = new URL(env.storage.endpoint).host;
  const payloadHash = sha256Hex(body);
  const allHeaders: Record<string, string> = {
    ...headers,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  const names = Object.keys(allHeaders)
    .map((name) => name.toLowerCase())
    .sort();
  const lookup = new Map(Object.entries(allHeaders).map(([name, value]) => [name.toLowerCase(), value]));
  const canonicalHeaders = names
    .map((name) => `${name}:${String(lookup.get(name)).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${env.storage.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${env.storage.secretAccessKey}`, day), env.storage.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  allHeaders.authorization =
    `AWS4-HMAC-SHA256 Credential=${env.storage.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const query = canonicalQuery ? `?${canonicalQuery}` : '';
  return {
    url: `${env.storage.endpoint}${canonicalPath}${query}`,
    method,
    headers: allHeaders,
    body: body.length > 0 ? body : undefined,
  };
}

function objectPath(key: string): string {
  const encodedKey = key.split('/').map(encodeSegment).join('/');
  return env.storage.forcePathStyle
    ? `/${encodeSegment(env.storage.bucket)}/${encodedKey}`
    : `/${encodedKey}`;
}

async function send(request: SignedRequest): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ? new Uint8Array(request.body) : null,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new StorageUnreachable(error instanceof Error ? error.message : 'request failed');
  }
  if (response.status >= 500) {
    throw new StorageUnreachable(`status ${response.status}`);
  }
  return response;
}

export async function putPhotoObject(
  key: string,
  body: Buffer,
  contentType: string,
  capturedAt: string,
): Promise<void> {
  const response = await send(
    signRequest(
      'PUT',
      objectPath(key),
      '',
      {
        'content-type': contentType,
        'content-length': String(body.length),
        'x-amz-meta-captured-at': capturedAt,
      },
      body,
    ),
  );
  if (!response.ok) {
    throw new StorageUnreachable(`PUT answered ${response.status}: ${await response.text()}`);
  }
}

export async function getPhotoObject(key: string): Promise<Buffer> {
  const response = await send(signRequest('GET', objectPath(key), '', {}, Buffer.alloc(0)));
  if (!response.ok) {
    throw new StorageUnreachable(`GET answered ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deletePhotoObject(key: string): Promise<void> {
  const response = await send(signRequest('DELETE', objectPath(key), '', {}, Buffer.alloc(0)));
  if (!response.ok && response.status !== 404) {
    throw new StorageUnreachable(`DELETE answered ${response.status}`);
  }
}

export async function probeStorage(): Promise<void> {
  const path = env.storage.forcePathStyle ? `/${encodeSegment(env.storage.bucket)}` : '/';
  const response = await send(signRequest('GET', path, 'max-keys=0', {}, Buffer.alloc(0)));
  if (!response.ok) {
    throw new StorageUnreachable(`bucket listing answered ${response.status}`);
  }
}

export function photoKey(loanRef: string, event: 'checkout' | 'checkin', photoId: number): string {
  return `loans/${loanRef}/${event}/${photoId}`;
}
