import { config } from '../config';
import { ProviderUnavailable } from '../http/errors';
import { signS3Request } from './sigv4';

const REQUEST_TIMEOUT_MS = 10_000;

export type PhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp';

const PHOTO_EXTENSIONS: Record<PhotoContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function photoExtension(contentType: PhotoContentType): string {
  return PHOTO_EXTENSIONS[contentType];
}

/** The image type judged from the leading bytes, never from a name or header. */
export function detectPhotoType(bytes: Buffer): PhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function objectUrl(key: string): URL {
  const base = config.s3.forcePathStyle
    ? `${config.s3.endpoint}/${config.s3.bucket}/${key}`
    : `${config.s3.endpoint.replace('://', `://${config.s3.bucket}.`)}/${key}`;
  return new URL(base);
}

async function send(
  method: 'GET' | 'PUT' | 'HEAD',
  url: URL,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers = signS3Request({
    method,
    url,
    headers: extraHeaders,
    payload,
    region: config.s3.region,
    service: 's3',
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
    at: new Date(),
  });
  try {
    return await fetch(url, {
      method,
      headers,
      ...(method === 'PUT' ? { body: new Uint8Array(payload) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ProviderUnavailable('storage', `Object storage is unreachable for ${method}`);
  }
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const response = await send('PUT', objectUrl(key), bytes, { 'content-type': contentType });
  if (!response.ok) {
    throw new ProviderUnavailable('storage', `Object storage answered ${response.status}`);
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send('GET', objectUrl(key), Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ProviderUnavailable('storage', `Object storage answered ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObjectQuietly(key: string): Promise<void> {
  const url = objectUrl(key);
  const headers = signS3Request({
    method: 'DELETE',
    url,
    headers: {},
    payload: Buffer.alloc(0),
    region: config.s3.region,
    service: 's3',
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
    at: new Date(),
  });
  await fetch(url, {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
}

/** Creates the private bucket when it is missing. */
export async function ensureBucket(): Promise<void> {
  const bucketUrl = new URL(`${config.s3.endpoint}/${config.s3.bucket}`);
  const head = await send('HEAD', bucketUrl, Buffer.alloc(0));
  if (head.ok) return;
  await send('PUT', bucketUrl, Buffer.alloc(0));
}

export function photoObjectKey(
  orderId: string,
  photoId: string,
  contentType: PhotoContentType,
): string {
  return `inspections/${orderId}/photos/${photoId}.${photoExtension(contentType)}`;
}

export function reportObjectKey(orderId: string, inspectionLinkId: string): string {
  return `inspections/${orderId}/report-${inspectionLinkId}.pdf`;
}
