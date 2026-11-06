import { config } from '../config.ts';
import { bucketPath, objectPath, signRequest, type S3Settings } from './s3.ts';

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('storage unavailable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

const settings: S3Settings = config.storage;

const EMPTY = Buffer.alloc(0);

async function send(
  method: string,
  path: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = signRequest(settings, method, path, body, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body.length === 0 ? undefined : body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send('HEAD', bucketPath(settings), EMPTY);
  if (head.ok) return;
  const created = await send('PUT', bucketPath(settings), EMPTY);
  if (!created.ok && created.status !== 409) {
    throw new StorageUnavailable(new Error(`bucket status ${created.status}`));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', objectPath(settings, key), body, {
    'content-type': contentType,
    'content-length': String(body.length),
  });
  if (!response.ok) throw new StorageUnavailable(new Error(`put status ${response.status}`));
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send('GET', objectPath(settings, key), EMPTY);
  if (!response.ok) throw new StorageUnavailable(new Error(`get status ${response.status}`));
  return Buffer.from(await response.arrayBuffer());
}

export function lookObjectKey(dropId: string, lookId: string, extension: string): string {
  return `looks/${dropId}/${lookId}.${extension}`;
}

export function pressZipKey(previewId: string): string {
  return `press/${previewId}.zip`;
}

export function extensionFor(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}
