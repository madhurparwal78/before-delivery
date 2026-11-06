import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors.ts';
import type { Ctx, UploadedFile } from './context.ts';

export const JSON_BODY_LIMIT = 100_000;
export const PHOTO_FILE_LIMIT = 5_000_000;
export const PHOTO_REQUEST_LIMIT = 5_100_000;

/** Refuses a non-GET request that names another origin. */
export function checkOrigin(ctx: Ctx): void {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return;
  const origin = ctx.header('origin');
  if (origin === '' || origin === 'null') return;
  const proto = ctx.header('x-forwarded-proto') || 'http';
  const expected = new Set([`http://${ctx.host}`, `https://${ctx.host}`, `${proto}://${ctx.host}`]);
  if (!expected.has(origin.toLowerCase())) {
    throw new ApiError('cross_origin');
  }
}

const DRAIN_CAP = 20_000_000;

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) {
      // The rest is read and dropped so the client can finish sending and still read the 413.
      over = true;
      chunks.length = 0;
      if (size > DRAIN_CAP) {
        req.destroy();
        break;
      }
      continue;
    }
    chunks.push(buffer);
  }
  if (over) throw new ApiError('too_large');
  return Buffer.concat(chunks);
}

function contentTypeBase(raw: string): string {
  return raw.split(';')[0]?.trim().toLowerCase() ?? '';
}

export async function readJsonBody(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req, JSON_BODY_LIMIT);
  ctx.rawBody = body;
  if (body.byteLength === 0) {
    ctx.json = {};
    return;
  }
  const base = contentTypeBase(ctx.header('content-type'));
  if (base !== 'application/json') {
    throw new ApiError('unsupported_media_type');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new ApiError('invalid_json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('invalid_json');
  }
  ctx.json = parsed as Record<string, unknown>;
}

function parseMultipart(body: Buffer, boundary: string): UploadedFile | null {
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.byteLength;
    if (body.subarray(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;
    const headerText = body.subarray(partStart, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    const contentEnd = next === -1 ? body.byteLength : next - 2;
    const content = body.subarray(headerEnd + 4, Math.max(headerEnd + 4, contentEnd));
    const nameMatch = headerText.match(/name="([^"]*)"/i);
    const field = nameMatch ? (nameMatch[1] as string) : '';
    if (/filename="/i.test(headerText)) {
      return { field, bytes: Buffer.from(content), truncated: false };
    }
    cursor = next;
  }
  return null;
}

export async function readMultipartBody(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req, PHOTO_REQUEST_LIMIT);
  ctx.rawBody = body;
  const raw = ctx.header('content-type');
  if (contentTypeBase(raw) !== 'multipart/form-data') {
    if (body.byteLength === 0) {
      ctx.upload = null;
      return;
    }
    throw new ApiError('unsupported_media_type');
  }
  const boundary = raw.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const marker = (boundary?.[1] ?? boundary?.[2] ?? '').trim();
  if (marker === '') throw new ApiError('unsupported_media_type');
  ctx.upload = parseMultipart(body, marker);
}

export type PhotoKind = 'image/jpeg' | 'image/png' | 'image/webp';

/** Judges a photo by its leading bytes, never by its file name. */
export function detectPhotoKind(bytes: Buffer): PhotoKind | null {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.byteLength >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function photoExtension(kind: PhotoKind): string {
  if (kind === 'image/jpeg') return 'jpg';
  if (kind === 'image/png') return 'png';
  return 'webp';
}
