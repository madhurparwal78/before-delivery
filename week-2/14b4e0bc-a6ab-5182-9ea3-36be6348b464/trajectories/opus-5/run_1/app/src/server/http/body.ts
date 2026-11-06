import type { IncomingMessage } from 'node:http';
import { errors } from './errors.ts';

export const JSON_BODY_LIMIT = 1_000_000;
export const MULTIPART_BODY_LIMIT = 6_000_000;
const MAX_JSON_DEPTH = 20;

export type JsonObject = Record<string, unknown>;

/** Reads the body, refusing anything over the limit before any other check. */
export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw errors.payloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function depthOf(value: unknown, depth = 1): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, depthOf(item, depth + 1)), depth);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value as JsonObject).reduce<number>(
      (max, item) => Math.max(max, depthOf(item, depth + 1)),
      depth,
    );
  }
  return depth;
}

export function parseJsonBody(raw: Buffer): JsonObject {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw errors.validation({});
  }
  if (depthOf(parsed) > MAX_JSON_DEPTH) throw errors.tooDeep();
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as JsonObject;
}

export interface MultipartFile {
  filename: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Map<string, string>;
  files: Map<string, MultipartFile>;
}

function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of block.split('\r\n')) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }
  return headers;
}

function parseDisposition(value: string): { name: string | null; filename: string | null } {
  const unescape = (raw: string): string => raw.replace(/\\(.)/g, '$1');
  const name = /;\s*name="((?:[^"\\]|\\.)*)"/.exec(value);
  const filename = /;\s*filename="((?:[^"\\]|\\.)*)"/.exec(value);
  return {
    name: name ? unescape(name[1]) : null,
    filename: filename ? unescape(filename[1]) : null,
  };
}

export function parseMultipart(raw: Buffer, contentType: string): MultipartBody {
  const body: MultipartBody = { fields: new Map(), files: new Map() };
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) return body;
  const boundary = (boundaryMatch[1] ?? boundaryMatch[2]).trim();
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');

  let cursor = raw.indexOf(delimiter);
  while (cursor !== -1) {
    let start = cursor + delimiter.length;
    if (raw.subarray(start, start + 2).toString('utf8') === '--') break;
    if (raw.subarray(start, start + 2).toString('utf8') === '\r\n') start += 2;
    const next = raw.indexOf(delimiter, start);
    const end = next === -1 ? raw.length : next - 2;
    const headerEnd = raw.indexOf('\r\n\r\n', start);
    if (headerEnd === -1 || headerEnd > end) break;
    const headers = parseHeaders(raw.subarray(start, headerEnd).toString('utf8'));
    const disposition = parseDisposition(headers.get('content-disposition') ?? '');
    const content = raw.subarray(headerEnd + 4, end);
    if (disposition.name !== null) {
      if (disposition.filename !== null) {
        body.files.set(disposition.name, { filename: disposition.filename, bytes: content });
      } else {
        body.fields.set(disposition.name, content.toString('utf8'));
      }
    }
    cursor = next;
  }
  return body;
}
