import type { IncomingMessage } from 'node:http';
import { payloadTooLarge, unsupportedMediaType } from './errors.js';

export const JSON_BODY_LIMIT = 65_536;
export const MULTIPART_BODY_LIMIT = 50_400_000;

export type BodyKind = 'none' | 'json' | 'multipart';

const contentTypeOf = (req: IncomingMessage): string =>
  (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

/**
 * The 413 and 415 checks come before everything else, so they are decided from
 * the headers alone, before the body is read or the caller is identified.
 */
export const checkBodyHeaders = (req: IncomingMessage, kind: BodyKind): void => {
  if (kind === 'none') return;
  const declared = Number.parseInt(req.headers['content-length'] ?? '', 10);
  const limit = kind === 'multipart' ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT;
  if (Number.isFinite(declared) && declared > limit) throw payloadTooLarge();
  const type = contentTypeOf(req);
  if (kind === 'json' && type !== 'application/json') throw unsupportedMediaType();
  if (kind === 'multipart' && type !== 'multipart/form-data') throw unsupportedMediaType();
};

const readRaw = async (req: IncomingMessage, limit: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) {
      req.destroy();
      throw payloadTooLarge();
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
};

export const readJsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const raw = await readRaw(req, JSON_BODY_LIMIT);
  if (raw.length === 0) return {};
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
};

export interface MultipartFile {
  readonly filename: string;
  readonly bytes: Buffer;
}

export interface MultipartBody {
  readonly fields: Record<string, string>;
  readonly files: Record<string, MultipartFile>;
}

const findBoundary = (contentType: string): string | null => {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const raw = match?.[1] ?? match?.[2];
  return raw === undefined ? null : raw.trim();
};

export const readMultipartBody = async (req: IncomingMessage): Promise<MultipartBody> => {
  const contentType = req.headers['content-type'] ?? '';
  const boundary = findBoundary(contentType);
  if (boundary === null) throw unsupportedMediaType();
  const raw = await readRaw(req, MULTIPART_BODY_LIMIT);

  const fields: Record<string, string> = {};
  const files: Record<string, MultipartFile> = {};
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = raw.indexOf(delimiter);
  while (cursor >= 0) {
    let start = cursor + delimiter.length;
    if (raw[start] === 0x2d && raw[start + 1] === 0x2d) break;
    if (raw[start] === 0x0d && raw[start + 1] === 0x0a) start += 2;
    const headerEnd = raw.indexOf('\r\n\r\n', start, 'latin1');
    if (headerEnd < 0) break;
    const headerText = raw.toString('utf8', start, headerEnd);
    const bodyStart = headerEnd + 4;
    const next = raw.indexOf(delimiter, bodyStart);
    const bodyEnd = next < 0 ? raw.length : next - 2;
    const body = raw.subarray(bodyStart, Math.max(bodyStart, bodyEnd));

    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const name = nameMatch?.[1];
    if (name !== undefined) {
      if (fileMatch !== null) files[name] = { filename: fileMatch[1] ?? '', bytes: Buffer.from(body) };
      else fields[name] = body.toString('utf8');
    }
    cursor = next;
  }
  return { fields, files };
};
