// Body parsing: JSON, multipart, photos, times. One place for the field validation messages.

import type { IncomingMessage } from 'node:http';
import { readBody, parseJson, JSON_BODY_LIMIT, MULTIPART_BODY_LIMIT, hasBody, checkJsonContentType, checkMultipartContentType, PHOTO_LIMIT } from './http';
import { tooLarge, sendJson } from './errors';

export interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  data: Buffer;
}

/** Parse multipart/form-data bodies without external packages. */
export function parseMultipart(body: Buffer, contentType: string): Map<string, MultipartPart> {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (match?.[1] ?? match?.[2] ?? '').trim();
  const out = new Map<string, MultipartPart>();
  if (boundary === '') return out;
  const delimiter = Buffer.from(`--${boundary}`);
  const closing = Buffer.from(`--${boundary}--`);
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    // cursor points at the start of "--boundary"
    let lineEnd = body.indexOf('\r\n', cursor);
    if (lineEnd === -1) break;
    if (body.subarray(cursor, cursor + closing.length).equals(closing)) break;
    const headerStart = lineEnd + 2;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) break;
    const headerText = body.slice(headerStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextDelimiter = body.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart);
    if (nextDelimiter === -1) break;
    const data = body.slice(dataStart, nextDelimiter);
    const headers = parseHeaders(headerText);
    const disposition = headers.get('content-disposition') ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    if (name !== '') out.set(name, { name, filename, contentType: headers.get('content-type') ?? null, data });
    cursor = nextDelimiter + 2;
  }
  return out;
}


function parseHeaders(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    out.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  return out;
}

export interface PhotoUpload {
  bytes: Buffer;
  contentType: string;
}

export function validatePhoto(part: MultipartPart | undefined): PhotoUpload | 'missing' | 'bad-type' | 'too-large' {
  if (part === undefined || part.data.length === 0) return 'missing';
  if (part.data.length > PHOTO_LIMIT) return 'too-large';
  const contentType = (part.contentType ?? '').toLowerCase();
  const okType = contentType === 'image/jpeg' || contentType === 'image/png' || contentType === 'image/webp';
  const signatureOk =
    (contentType === 'image/jpeg' && part.data[0] === 0xff && part.data[1] === 0xd8) ||
    (contentType === 'image/png' && part.data[0] === 0x89 && part.data[1] === 0x50) ||
    (contentType === 'image/webp' && part.data.subarray(0, 4).toString('ascii') === 'RIFF' && part.data.subarray(8, 12).toString('ascii') === 'WEBP');
  if (!okType || !signatureOk) return 'bad-type';
  return { bytes: part.data, contentType };
}

export function validateCapturedAt(text: string | undefined, now: Date): Date | 'missing' | 'bad' {
  if (text === undefined || text.trim() === '') return 'missing';
  const instant = parseIsoInstant(text.trim());
  if (instant === null) return 'bad';
  if (instant.getTime() > now.getTime() + 10 * 60 * 1000) return 'bad';
  return instant;
}

/** ISO 8601 with an offset or Z. */
export function parseIsoInstant(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:?\d{2})$/.exec(text);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s, frac, offRaw] = m;
  if (y === undefined || mo === undefined || d === undefined || h === undefined || mi === undefined || offRaw === undefined) return null;
  const seconds = s === undefined ? 0 : Number(s);
  const millis = frac === undefined ? 0 : Number((frac + '000').slice(0, 3));
  let offsetMinutes = 0;
  if (offRaw !== 'Z') {
    const sign = offRaw.startsWith('-') ? -1 : 1;
    const hh = Number(offRaw.slice(1, 3));
    const mm = Number(offRaw.slice(-2));
    offsetMinutes = sign * (hh * 60 + mm);
  }
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), seconds, millis) - offsetMinutes * 60000;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export async function readJson<T>(req: IncomingMessage): Promise<T | null> {
  checkJsonContentType(req);
  const raw = await readBody(req, JSON_BODY_LIMIT, false);
  if (raw.length > JSON_BODY_LIMIT) throw tooLarge();
  return parseJson<T>(raw);
}

export async function readMultipart(req: IncomingMessage): Promise<Map<string, MultipartPart> | null> {
  checkMultipartContentType(req);
  if (!hasBody(req)) return new Map();
  const raw = await readBody(req, MULTIPART_BODY_LIMIT, true);
  const contentType = req.headers['content-type'] ?? '';
  return parseMultipart(raw, contentType);
}

/** Read the raw body for the precedence's "look inside the body" step, within the size limit. */
export async function readBodyForInspection(req: IncomingMessage): Promise<Buffer> {
  // The content-type check (step 5) happens before the size refusal (step 6), so read past
  // the JSON limit here and let the callers apply their checks in order.
  return readBody(req, MULTIPART_BODY_LIMIT, true);
}

/** Parse a body as a JSON object, whatever its content type; null when it is not one. */
export function parseJsonBody(raw: Buffer): Record<string, unknown> | null {
  const parsed = parseJson<Record<string, unknown>>(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

/** Apply the content-type check for a body that was read for inspection, then parse it as JSON. */
export function bodyFromInspection(req: IncomingMessage, raw: Buffer): unknown {
  checkJsonContentType(req);
  return parseJson<unknown>(raw);
}

/** Content-type check against an already-read body: step 5 (415) precedes step 6 (413). */
export function checkJsonContentTypeForRaw(req: IncomingMessage, raw: Buffer): void {
  if (raw.length === 0 && !hasBody(req)) return;
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (contentType !== 'application/json') throw sendJson();
}

export { sendJson };
