/** Request body limits, JSON parsing and multipart parsing. */

import type { IncomingMessage } from 'node:http';
import * as errors from './errors.js';

export const JSON_BODY_LIMIT = 65_536;
export const MULTIPART_BODY_LIMIT = 5_100_000;
export const UPLOAD_FILE_LIMIT = 5_000_000;

/**
 * Reads at most `limit` bytes; anything longer is `payload_too_large`.
 *
 * An over-long body is read to its end and discarded rather than cutting the
 * connection, so the client still receives the 413 rather than a reset socket.
 */
export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = Number(request.headers['content-length'] ?? 0) > limit;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) tooLarge = true;
    if (!tooLarge) chunks.push(buffer);
  }
  if (tooLarge) throw errors.payloadTooLarge();
  return Buffer.concat(chunks);
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function parseJsonObject(raw: Buffer): JsonObject {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw errors.validation({ body: 'Send a JSON object.' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw errors.validation({ body: 'Send a JSON object.' });
  }
  return parsed as JsonObject;
}

export interface UploadedFile {
  filename: string;
  declaredContentType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: Record<string, UploadedFile>;
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value ? value.trim() : null;
}

function splitOn(haystack: Buffer, needle: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      parts.push(haystack.subarray(from));
      return parts;
    }
    parts.push(haystack.subarray(from, at));
    from = at + needle.length;
  }
}

export function parseMultipart(raw: Buffer, contentType: string): MultipartBody {
  const boundary = boundaryOf(contentType);
  if (boundary === null) throw errors.unsupportedMediaType();

  const fields: Record<string, string> = {};
  const files: Record<string, UploadedFile> = {};
  const segments = splitOn(raw, Buffer.from(`--${boundary}`));

  for (const segment of segments.slice(1)) {
    if (segment.length < 2 || segment.subarray(0, 2).toString('latin1') === '--') continue;
    const body = segment.subarray(2);
    const headerEnd = body.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = body.subarray(0, headerEnd).toString('utf8');
    let content = body.subarray(headerEnd + 4);
    if (content.subarray(-2).toString('latin1') === '\r\n') {
      content = content.subarray(0, content.length - 2);
    }

    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    if (name === undefined) continue;
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    if (filename === undefined) {
      fields[name] = content.toString('utf8');
    } else {
      files[name] = {
        filename,
        declaredContentType:
          /content-type:\s*([^\r\n;]+)/i.exec(headerText)?.[1]?.trim() ?? 'application/octet-stream',
        bytes: content,
      };
    }
  }
  return { fields, files };
}

export type DetectedType = 'application/pdf' | 'image/png' | 'image/jpeg';

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** The type is judged by the file's first bytes, never by its name or declared type. */
export function detectFileType(bytes: Buffer): DetectedType | null {
  if (bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return 'application/pdf';
  if (bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'image/png';
  if (bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'image/jpeg';
  return null;
}

export const EXTENSION_FOR_TYPE: Record<DetectedType, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/** Kept only as display text: directories, `..` and control characters are stripped. */
export function sanitiseOriginalName(name: string): string {
  const lastSeparator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const base = lastSeparator === -1 ? name : name.slice(lastSeparator + 1);
  return base
    .replace(/\.\./g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 120);
}
