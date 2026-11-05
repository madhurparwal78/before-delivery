import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors.js';

export const MAX_JSON_BYTES = 64_000;
export const MAX_MULTIPART_BYTES = 101_000_000;

/** Reads the whole body, refusing one byte over the published limit. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = req.headers['content-length'];
  if (declared !== undefined) {
    const n = Number.parseInt(declared, 10);
    if (Number.isFinite(n) && n > limit) throw new ApiError('body_too_large');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > limit) {
      req.destroy();
      throw new ApiError('body_too_large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function contentTypeOf(req: IncomingMessage): string {
  const raw = req.headers['content-type'];
  if (raw === undefined) return '';
  return (raw.split(';', 1)[0] ?? '').trim().toLowerCase();
}

function boundaryOf(req: IncomingMessage): string | null {
  const raw = req.headers['content-type'];
  if (raw === undefined) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(raw);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : value.trim();
}

export interface FilePart {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

export class MultipartForm {
  private readonly fieldValues: Map<string, string>;
  private readonly fileValues: Map<string, FilePart>;

  constructor(fields: Map<string, string>, files: Map<string, FilePart>) {
    this.fieldValues = fields;
    this.fileValues = files;
  }

  field(name: string): string | null {
    return this.fieldValues.get(name) ?? null;
  }

  file(name: string): FilePart | null {
    return this.fileValues.get(name) ?? null;
  }

  /** The request body as it is hashed for idempotent replay. */
  signature(): string {
    const parts: string[] = [];
    for (const [k, v] of [...this.fieldValues].sort(([a], [b]) => (a < b ? -1 : 1))) {
      parts.push(`${k}=${v}`);
    }
    for (const [k, v] of [...this.fileValues].sort(([a], [b]) => (a < b ? -1 : 1))) {
      parts.push(`${k}:${v.filename}:${v.bytes.length}`);
    }
    return parts.join('\n');
  }
}

function headerValue(headerBlock: string, name: string): string | null {
  const re = new RegExp(`^${name}:\\s*(.*)$`, 'im');
  const m = re.exec(headerBlock);
  return m?.[1]?.trim() ?? null;
}

/** Parses a `multipart/form-data` body into its fields and file parts. */
export function parseMultipart(req: IncomingMessage, body: Buffer): MultipartForm {
  const boundary = boundaryOf(req);
  if (boundary === null) throw new ApiError('unsupported_media_type');
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map<string, string>();
  const files = new Map<string, FilePart>();

  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    let start = cursor + delimiter.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break; // closing `--`
    if (body[start] === 0x0d) start += 1;
    if (body[start] === 0x0a) start += 1;
    const headerEnd = body.indexOf('\r\n\r\n', start, 'latin1');
    if (headerEnd === -1) break;
    const headerBlock = body.subarray(start, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;
    const next = body.indexOf(delimiter, contentStart);
    const contentEnd = next === -1 ? body.length : next - 2; // strip the trailing CRLF
    const content = body.subarray(contentStart, Math.max(contentStart, contentEnd));

    const disposition = headerValue(headerBlock, 'content-disposition') ?? '';
    const nameMatch = /name="([^"]*)"/i.exec(disposition);
    const filenameMatch = /filename="([^"]*)"/i.exec(disposition);
    const name = nameMatch?.[1];
    if (name !== undefined) {
      if (filenameMatch !== undefined && filenameMatch !== null) {
        files.set(name, {
          filename: filenameMatch[1] ?? '',
          contentType: headerValue(headerBlock, 'content-type') ?? '',
          bytes: Buffer.from(content),
        });
      } else {
        fields.set(name, content.toString('utf8'));
      }
    }
    cursor = next;
  }
  return new MultipartForm(fields, files);
}

/** Parses a JSON object body. A body that isn't a JSON object is a validation failure. */
export function parseJsonObject(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new ApiError('validation_failed', { fields: [] });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('validation_failed', { fields: [] });
  }
  return parsed as Record<string, unknown>;
}
