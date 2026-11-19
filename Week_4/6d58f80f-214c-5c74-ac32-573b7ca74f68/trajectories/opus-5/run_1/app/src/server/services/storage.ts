import { Readable } from 'node:stream';
import { config } from '../config.js';
import { encodeKeyPath, signRequest } from './sigv4.js';

export class StorageDown extends Error {}

const credentials = {
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey,
  region: config.s3.region,
  service: 's3',
};

/** Probes and small calls answer quickly; moving bytes is given room. */
const PROBE_TIMEOUT_MS = 4_000;
const DATA_TIMEOUT_MS = 60_000;

const endpointFor = (key: string | null, query: Record<string, string> = {}): string => {
  const base = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${key === null ? '' : `/${encodeKeyPath(key)}`}`
    : `${key === null ? '/' : `/${encodeKeyPath(key)}`}`;
  if (!config.s3.forcePathStyle) base.host = `${config.s3.bucket}.${base.host}`;
  base.pathname = path;
  for (const [name, value] of Object.entries(query)) base.searchParams.set(name, value);
  return base.toString();
};

interface CallOptions {
  method: string;
  key: string | null;
  query?: Record<string, string>;
  body?: Buffer;
  contentType?: string;
  stream?: boolean;
  allowStatuses?: number[];
  timeoutMs?: number;
}

interface CallResult {
  status: number;
  headers: Headers;
  text: string;
  body: ReadableStream<Uint8Array> | null;
}

const call = async (options: CallOptions): Promise<CallResult> => {
  const url = endpointFor(options.key, options.query ?? {});
  const headers: Record<string, string> = {};
  if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  if (options.body !== undefined) headers['content-length'] = String(options.body.length);
  const signed = signRequest(
    { url, method: options.method, headers, body: options.body },
    credentials,
    new Date(),
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers: signed,
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
    });
  } catch {
    markDown();
    throw new StorageDown('storage unreachable');
  }

  if (response.status >= 500) {
    markDown();
    throw new StorageDown(`storage answered ${response.status}`);
  }
  markUp();

  if (options.stream === true && response.ok) {
    return { status: response.status, headers: response.headers, text: '', body: response.body };
  }
  const text = await response.text();
  const allowed = options.allowStatuses ?? [];
  if (!response.ok && !allowed.includes(response.status)) {
    throw new Error(`storage ${options.method} ${options.key ?? ''} failed: ${response.status} ${text}`);
  }
  if (response.ok && text.includes('<Error>')) {
    throw new Error(`storage ${options.method} returned an error body: ${text}`);
  }
  return { status: response.status, headers: response.headers, text, body: null };
};

let up = true;
const listeners = new Set<(value: boolean) => void>();

const markDown = (): void => {
  if (up) {
    up = false;
    for (const listener of listeners) listener(false);
  }
};

const markUp = (): void => {
  if (!up) {
    up = true;
    for (const listener of listeners) listener(true);
  }
};

export const storageUp = (): boolean => up;
export const onStorageChange = (listener: (value: boolean) => void): void => {
  listeners.add(listener);
};

export const probeStorage = async (): Promise<boolean> => {
  try {
    await call({ method: 'HEAD', key: null, allowStatuses: [403, 404] });
    return true;
  } catch {
    return false;
  }
};

export const ensureBucket = async (): Promise<void> => {
  const head = await call({ method: 'HEAD', key: null, allowStatuses: [404, 403] });
  if (head.status === 404) await call({ method: 'PUT', key: null });
};

export const objectKey = (fileId: string): string => `files/${fileId}`;

const tag = (xml: string, name: string): string | null => {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match === null ? null : (match[1] ?? null);
};

export const createMultipart = async (fileId: string, contentType: string): Promise<string> => {
  const result = await call({
    method: 'POST',
    key: objectKey(fileId),
    query: { uploads: '' },
    contentType,
    body: Buffer.alloc(0),
  });
  const uploadId = tag(result.text, 'UploadId');
  if (uploadId === null) throw new Error('storage did not return an upload id');
  return uploadId;
};

export const uploadPart = async (
  fileId: string,
  storageUploadId: string,
  partNumber: number,
  body: Buffer,
): Promise<string> => {
  const result = await call({
    method: 'PUT',
    key: objectKey(fileId),
    query: { partNumber: String(partNumber), uploadId: storageUploadId },
    body,
    timeoutMs: DATA_TIMEOUT_MS,
  });
  const etag = result.headers.get('etag');
  if (etag === null) throw new Error('storage did not return a part etag');
  return etag;
};

export const completeMultipart = async (
  fileId: string,
  storageUploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> => {
  const xml = `<CompleteMultipartUpload>${parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
    .join('')}</CompleteMultipartUpload>`;
  const result = await call({
    method: 'POST',
    key: objectKey(fileId),
    query: { uploadId: storageUploadId },
    body: Buffer.from(xml, 'utf8'),
    contentType: 'application/xml',
    timeoutMs: DATA_TIMEOUT_MS,
    allowStatuses: [404],
  });
  // Storage may have finished the object before an earlier attempt gave up on the answer.
  if (result.status === 404) await headObject(fileId);
};

export const abortMultipart = async (fileId: string, storageUploadId: string): Promise<void> => {
  await call({
    method: 'DELETE',
    key: objectKey(fileId),
    query: { uploadId: storageUploadId },
    allowStatuses: [404],
  });
};

export const putObject = async (
  fileId: string,
  body: Buffer,
  contentType: string,
): Promise<void> => {
  await call({
    method: 'PUT',
    key: objectKey(fileId),
    body,
    contentType,
    timeoutMs: DATA_TIMEOUT_MS,
  });
};

export const headObject = async (fileId: string): Promise<{ size: number; contentType: string }> => {
  const result = await call({ method: 'HEAD', key: objectKey(fileId) });
  return {
    size: Number(result.headers.get('content-length') ?? '0'),
    contentType: result.headers.get('content-type') ?? 'application/octet-stream',
  };
};

export const deleteObject = async (fileId: string): Promise<void> => {
  await call({ method: 'DELETE', key: objectKey(fileId), allowStatuses: [404] });
};

export const getObjectStream = async (
  fileId: string,
): Promise<{ stream: Readable; size: number }> => {
  const result = await call({
    method: 'GET',
    key: objectKey(fileId),
    stream: true,
    timeoutMs: DATA_TIMEOUT_MS,
  });
  if (result.body === null) throw new Error('storage returned no body');
  return {
    stream: Readable.fromWeb(result.body as Parameters<typeof Readable.fromWeb>[0]),
    size: Number(result.headers.get('content-length') ?? '0'),
  };
};
