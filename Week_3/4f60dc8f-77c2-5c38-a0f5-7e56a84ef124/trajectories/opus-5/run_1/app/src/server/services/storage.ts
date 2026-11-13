import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { AppError } from '../http/app-error.js';

const UNSIGNED = 'UNSIGNED-PAYLOAD';
const SERVICE = 's3';

const sha256Hex = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest();

const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const encodeKeyPath = (key: string): string => key.split('/').map(encodeSegment).join('/');

type SignedRequest = {
  method: string;
  path: string;
  queryEntries?: [string, string][];
  body?: Buffer;
  extraHeaders?: Record<string, string>;
};

const signRequest = ({ method, path, queryEntries = [], body, extraHeaders = {} }: SignedRequest) => {
  const endpoint = new URL(config.s3.endpoint);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const host = endpoint.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': UNSIGNED,
    'x-amz-date': amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };
  if (body !== undefined) headers['content-length'] = String(body.byteLength);

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalQuery = queryEntries
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  signingKey = hmac(signingKey, config.s3.region);
  signingKey = hmac(signingKey, SERVICE);
  signingKey = hmac(signingKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers.host;

  const url = `${endpoint.origin}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  return { url, headers };
};

export class StorageUnavailable extends AppError {
  constructor() {
    super('storage_unavailable');
  }
}

const send = async (request: SignedRequest, expect: number[]): Promise<Response> => {
  const { url, headers } = signRequest(request);
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : new Uint8Array(request.body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new StorageUnavailable();
  }
  if (!expect.includes(response.status)) {
    await response.arrayBuffer().catch(() => undefined);
    if (response.status >= 500) throw new StorageUnavailable();
    throw new StorageError(response.status);
  }
  return response;
};

export class StorageError extends Error {
  constructor(readonly status: number) {
    super(`storage responded ${status}`);
  }
}

const objectPath = (key: string): string =>
  config.s3.forcePathStyle
    ? `/${encodeSegment(config.s3.bucket)}/${encodeKeyPath(key)}`
    : `/${encodeKeyPath(key)}`;

const bucketPath = (): string =>
  config.s3.forcePathStyle ? `/${encodeSegment(config.s3.bucket)}` : '/';

export const storageUp = async (): Promise<boolean> => {
  try {
    await send({ method: 'HEAD', path: bucketPath() }, [200, 403, 404]);
    return true;
  } catch {
    return false;
  }
};

export const putObject = async (
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> => {
  await send(
    { method: 'PUT', path: objectPath(key), body, extraHeaders: { 'content-type': contentType } },
    [200],
  );
};

export type HeadResult = { size: number; contentType: string };

export const headObject = async (key: string): Promise<HeadResult | null> => {
  try {
    const response = await send({ method: 'HEAD', path: objectPath(key) }, [200]);
    return {
      size: Number(response.headers.get('content-length') ?? '0'),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  } catch (error) {
    if (error instanceof StorageError && error.status === 404) return null;
    throw error;
  }
};

export const getObjectStream = async (key: string): Promise<Readable> => {
  const response = await send({ method: 'GET', path: objectPath(key) }, [200]);
  if (response.body === null) throw new StorageUnavailable();
  return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
};

export const getObjectRange = async (key: string, start: number, end: number): Promise<Buffer> => {
  const response = await send(
    { method: 'GET', path: objectPath(key), extraHeaders: { range: `bytes=${start}-${end}` } },
    [200, 206],
  );
  return Buffer.from(await response.arrayBuffer());
};

const textBetween = (xml: string, tag: string): string => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? match[1] : '';
};

export const createMultipartUpload = async (
  key: string,
  contentType: string,
): Promise<string> => {
  const response = await send(
    {
      method: 'POST',
      path: objectPath(key),
      queryEntries: [['uploads', '']],
      body: Buffer.alloc(0),
      extraHeaders: { 'content-type': contentType },
    },
    [200],
  );
  const uploadId = textBetween(await response.text(), 'UploadId');
  if (uploadId === '') throw new StorageUnavailable();
  return uploadId;
};

export const uploadPart = async (
  key: string,
  uploadId: string,
  partNumber: number,
  body: Buffer,
): Promise<string> => {
  const response = await send(
    {
      method: 'PUT',
      path: objectPath(key),
      queryEntries: [
        ['partNumber', String(partNumber)],
        ['uploadId', uploadId],
      ],
      body,
    },
    [200],
  );
  const etag = response.headers.get('etag');
  if (etag === null) throw new StorageUnavailable();
  return etag;
};

export const completeMultipartUpload = async (
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> => {
  const body = Buffer.from(
    `<CompleteMultipartUpload>${parts
      .map(
        (part) =>
          `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`,
      )
      .join('')}</CompleteMultipartUpload>`,
    'utf8',
  );
  const response = await send(
    {
      method: 'POST',
      path: objectPath(key),
      queryEntries: [['uploadId', uploadId]],
      body,
      extraHeaders: { 'content-type': 'application/xml' },
    },
    [200],
  );
  const xml = await response.text();
  if (xml.includes('<Error>')) throw new StorageUnavailable();
};

export const abortMultipartUpload = async (key: string, uploadId: string): Promise<void> => {
  await send(
    {
      method: 'DELETE',
      path: objectPath(key),
      queryEntries: [['uploadId', uploadId]],
    },
    [204, 200, 404],
  ).catch(() => undefined);
};

export const MIN_PART_BYTES = 8 * 1024 * 1024;
