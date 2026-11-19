/**
 * Reading a request: size limits decided before the body is parsed, JSON with a
 * nesting limit, and multipart with the file limit counted on the file alone.
 */
import type { IncomingMessage } from 'node:http';
import { F } from '../../shared/feedback.ts';
import { fail } from './errors.ts';

export const JSON_BODY_LIMIT = 1_000_000;
export const JSON_NESTING_LIMIT = 16;
export const PHOTOGRAPH_FILE_LIMIT = 8_000_000;
export const WORKBOOK_FILE_LIMIT = 2_000_000;
export const QUERY_TEXT_LIMIT = 200;

/**
 * Reads the body, stopping as soon as it passes `limit`. The refusal is decided
 * before the body is parsed and before authentication.
 */
export async function readBody(
  request: IncomingMessage,
  limit: number,
  overLimitMessage: string,
): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limit) {
      request.resume();
      throw fail.tooLarge(overLimitMessage);
    }
  }

  const parts: Buffer[] = [];
  let total = 0;
  for await (const piece of request) {
    const buffer = piece as Buffer;
    total += buffer.length;
    if (total > limit) {
      request.resume();
      throw fail.tooLarge(overLimitMessage);
    }
    parts.push(buffer);
  }
  return Buffer.concat(parts);
}

function depthOf(value: unknown, depth = 1): number {
  if (depth > JSON_NESTING_LIMIT + 1) return depth;
  if (Array.isArray(value)) {
    let deepest = depth;
    for (const item of value) deepest = Math.max(deepest, depthOf(item, depth + 1));
    return deepest;
  }
  if (value !== null && typeof value === 'object') {
    let deepest = depth;
    for (const item of Object.values(value)) deepest = Math.max(deepest, depthOf(item, depth + 1));
    return deepest;
  }
  return depth;
}

export type JsonObject = Record<string, unknown>;

/** Reads a JSON object body, refusing malformed text and over-deep nesting. */
export function parseJsonObject(raw: Buffer): JsonObject {
  if (raw.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw fail.malformedJson();
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw fail.malformedJson();
  }
  if (depthOf(value) > JSON_NESTING_LIMIT) {
    throw fail.invalid('That body is nested too deeply.');
  }
  return value as JsonObject;
}

export function contentTypeOf(request: IncomingMessage): string {
  const header = request.headers['content-type'];
  return (header ?? '').split(';')[0]!.trim().toLowerCase();
}

// ------------------------------------------------------------------- multipart

export interface MultipartField {
  name: string;
  value: string;
}

export interface MultipartFile {
  name: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface Multipart {
  fields: MultipartField[];
  files: MultipartFile[];
}

function boundaryOf(request: IncomingMessage): string {
  const header = request.headers['content-type'] ?? '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(header);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw fail.unsupportedMediaType();
  return boundary.trim();
}

/**
 * Splits a multipart body. The per-file limit is checked on each file's own
 * bytes, never on the whole body.
 */
export function parseMultipart(
  request: IncomingMessage,
  raw: Buffer,
  fileLimit: number,
  overLimitMessage: string,
): Multipart {
  const boundary = Buffer.from(`--${boundaryOf(request)}`);
  const CRLF2 = Buffer.from('\r\n\r\n');
  const out: Multipart = { fields: [], files: [] };

  let at = raw.indexOf(boundary, 0);
  if (at === -1) throw fail.invalid('That multipart body could not be read.');
  at += boundary.length;

  for (;;) {
    if (raw[at] === 0x2d && raw[at + 1] === 0x2d) break;
    if (raw[at] === 0x0d && raw[at + 1] === 0x0a) at += 2;

    const headerEnd = raw.indexOf(CRLF2, at);
    if (headerEnd === -1) break;
    const headerText = raw.subarray(at, headerEnd).toString('utf8');

    const next = raw.indexOf(boundary, headerEnd + 4);
    if (next === -1) throw fail.invalid('That multipart body could not be read.');
    let end = next;
    if (raw[end - 2] === 0x0d && raw[end - 1] === 0x0a) end -= 2;
    const body = raw.subarray(headerEnd + 4, end);

    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileNameMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerText);
    const name = nameMatch?.[1] ?? '';

    if (fileNameMatch) {
      if (body.length > fileLimit) throw fail.tooLarge(overLimitMessage);
      out.files.push({
        name,
        fileName: fileNameMatch[1] ?? '',
        contentType: (typeMatch?.[1] ?? 'application/octet-stream').trim().toLowerCase(),
        bytes: new Uint8Array(body),
      });
    } else {
      out.fields.push({ name, value: body.toString('utf8') });
    }

    at = next + boundary.length;
  }
  return out;
}

export function fieldValue(parts: Multipart, name: string): string | undefined {
  return parts.fields.find((f) => f.name === name)?.value;
}

export const SIZE_MESSAGES = {
  json: 'That request is larger than 1,000,000 bytes.',
  photograph: F.fileTooBig,
  workbook: F.workbookTooBig,
} as const;
