import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

export class StorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Object storage is unreachable');
    this.name = 'StorageUnavailableError';
    this.cause = cause;
  }
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; dateOnly: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, dateOnly: stamp.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer | undefined;
}

/** Path-style addressing puts the bucket in the URI; virtual-host style puts it in the host. */
function target(key: string): { origin: string; host: string; uri: string } {
  const endpoint = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) {
    return {
      origin: endpoint.origin,
      host: endpoint.host,
      uri: encodePath(`/${config.s3.bucket}${key === '' ? '' : `/${key}`}`),
    };
  }
  const host = `${config.s3.bucket}.${endpoint.host}`;
  return { origin: `${endpoint.protocol}//${host}`, host, uri: encodePath(`/${key}`) };
}

function signRequest(
  method: string,
  key: string,
  body: Buffer | undefined,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = target(key);
  const canonicalUri = endpoint.uri;
  const url = `${endpoint.origin}${canonicalUri}`;
  const payloadHash = sha256Hex(body ?? '');
  const { stamp, dateOnly } = amzDate(new Date());

  const headers: Record<string, string> = { host: endpoint.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers[name.toLowerCase()] = value;
  }

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${(headers[name] ?? '').trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateOnly}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateOnly);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url, method, headers, body };
}

async function send(signed: SignedRequest): Promise<Response> {
  try {
    return await fetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: signed.body,
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new StorageUnavailableError(error);
  }
}

async function ensureBucket(): Promise<void> {
  const head = await send(signRequest('HEAD', '', undefined, {}));
  if (head.ok) {
    return;
  }
  if (head.status !== 404) {
    throw new StorageUnavailableError(new Error(`HeadBucket answered ${head.status}`));
  }
  const created = await send(signRequest('PUT', '', Buffer.alloc(0), {}));
  if (!created.ok && created.status !== 409) {
    throw new StorageUnavailableError(new Error(`CreateBucket answered ${created.status}`));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const response = await send(
    signRequest('PUT', key, body, {
      'content-type': contentType,
      'content-length': String(body.byteLength),
    }),
  );
  if (!response.ok) {
    throw new StorageUnavailableError(new Error(`PutObject answered ${response.status}`));
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send(signRequest('GET', key, undefined, {}));
  if (!response.ok) {
    throw new StorageUnavailableError(new Error(`GetObject answered ${response.status}`));
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function headObject(key: string): Promise<void> {
  const response = await send(signRequest('HEAD', key, undefined, {}));
  if (!response.ok) {
    throw new StorageUnavailableError(new Error(`HeadObject answered ${response.status}`));
  }
}
