import type { IncomingMessage, ServerResponse } from 'node:http';
import { MSG, copy } from '../shared/messages';
import type { JsonValue } from '../shared/types';

export const JSON_BODY_LIMIT = 1048576;
export const MULTIPART_BODY_LIMIT = 10485760;

/** Every API error uses the one published shape, built here. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors?: Record<string, string>;

  constructor(status: number, code: string, message: string, errors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }

  body(): Record<string, JsonValue> {
    const body: Record<string, JsonValue> = { error: this.code, message: this.message };
    if (this.errors) body.errors = this.errors;
    return body;
  }
}

export const errors = {
  unauthenticated: (): ApiError => new ApiError(401, 'unauthenticated', MSG.unauthenticated),
  notFound: (): ApiError => new ApiError(404, 'not_found', MSG.notFound),
  forbidden: (message: string): ApiError => new ApiError(403, 'forbidden', message),
  crossOrigin: (): ApiError => new ApiError(403, 'cross_origin', MSG.crossOrigin),
  validation: (fields: Record<string, string>): ApiError =>
    new ApiError(422, 'validation', Object.values(fields)[0] ?? 'Invalid request.', fields),
  conflict: (code: string, message: string): ApiError => new ApiError(409, code, message),
  limitReached: (limit: number): ApiError =>
    new ApiError(409, 'limit_reached', copy.publishLimit(limit)),
  storageUnavailable: (message: string): ApiError =>
    new ApiError(503, 'storage_unavailable', message),
  immutable: (): ApiError => new ApiError(405, 'immutable', MSG.immutable),
  tooLarge: (limit: number): ApiError => new ApiError(413, 'too_large', copy.tooLarge(limit)),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', MSG.unsupportedMediaType),
  inviteUnavailable: (): ApiError =>
    new ApiError(410, 'invite_unavailable', MSG.inviteUnavailable),
  wrongPerson: (email: string): ApiError =>
    new ApiError(409, 'wrong_person', MSG.wrongPerson(email)),
};

export function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export async function readRawBody(
  request: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > limit) throw errors.tooLarge(limit);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, JsonValue>> {
  const contentType = (request.headers['content-type'] ?? '').toLowerCase();
  if (contentType !== '' && !contentType.includes('application/json')) {
    throw errors.unsupportedMediaType();
  }
  const raw = await readRawBody(request, JSON_BODY_LIMIT);
  if (raw.byteLength === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as JsonValue;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw errors.validation({ body: 'Send a JSON object.' });
    }
    return parsed as Record<string, JsonValue>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw errors.validation({ body: 'Send a JSON object.' });
  }
}

export interface MultipartField {
  name: string;
  value: string;
}

export interface MultipartFile {
  name: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
}

export async function readMultipartBody(request: IncomingMessage): Promise<MultipartBody> {
  const contentType = request.headers['content-type'] ?? '';
  const raw = await readRawBody(request, MULTIPART_BODY_LIMIT);
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw errors.validation({ file: 'Send a multipart form.' });
  const boundary = `--${match[1] ?? match[2]}`;
  const fields: Record<string, string> = {};
  const files: Record<string, MultipartFile> = {};
  let position = raw.indexOf(boundary);
  while (position !== -1) {
    const partStart = position + boundary.length;
    if (raw.slice(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = raw.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;
    const headerText = raw.slice(partStart + 2, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextBoundary = raw.indexOf(boundary, bodyStart);
    const bodyEnd = nextBoundary === -1 ? raw.byteLength : nextBoundary - 2;
    const body = raw.slice(bodyStart, bodyEnd);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileNameMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    const name = nameMatch?.[1] ?? '';
    if (fileNameMatch) {
      files[name] = {
        name,
        fileName: fileNameMatch[1],
        contentType: (typeMatch?.[1] ?? 'application/octet-stream').trim(),
        data: body,
      };
    } else {
      fields[name] = body.toString('utf8');
    }
    position = nextBoundary;
  }
  return { fields, files };
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(text);
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': body.byteLength,
    ...headers,
  });
  response.end(body);
}

export function sendHtml(response: ServerResponse, status: number, html: string): void {
  const body = Buffer.from(html, 'utf8');
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
  });
  response.end(body);
}
