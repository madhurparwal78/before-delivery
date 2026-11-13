import type { IncomingMessage, ServerResponse } from 'node:http';
import { LIMITS } from './config.js';
import {
  ApiError,
  crossOrigin,
  tooLarge,
  unsupportedMediaType,
  validation,
} from './errors.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function assertSameOrigin(req: IncomingMessage): void {
  if (!STATE_CHANGING.has(req.method ?? 'GET')) return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  try {
    if (new URL(origin).host === req.headers.host) return;
  } catch {
    throw crossOrigin();
  }
  throw crossOrigin();
}

function contentType(req: IncomingMessage): string {
  return (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw tooLarge('That request is too large');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > limit) {
      req.destroy();
      throw tooLarge('That request is too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Size first, then content type, as the published precedence requires. */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req, LIMITS.jsonBodyBytes);
  if (contentType(req) !== 'application/json') {
    throw unsupportedMediaType('Send this request as application/json');
  }
  if (raw.byteLength === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw validation({ body: 'Send a JSON object' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw validation({ body: 'Send a JSON object' });
  }
  return parsed as Record<string, unknown>;
}

export interface MultipartFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
}

/**
 * The multipart envelope may carry one 5,000,000 byte file plus its part
 * headers, so the body cap sits a little above the published file limit while
 * each file part is held to exactly that limit.
 */
const MULTIPART_ENVELOPE_SLACK = 65_536;

export async function readMultipartBody(req: IncomingMessage): Promise<MultipartBody> {
  const raw = await readBody(req, LIMITS.uploadFileBytes + MULTIPART_ENVELOPE_SLACK);
  if (contentType(req) !== 'multipart/form-data') {
    throw unsupportedMediaType('Send this request as multipart/form-data');
  }
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type'] ?? '');
  const marker = boundary?.[1] ?? boundary?.[2];
  if (marker === undefined) throw unsupportedMediaType('Send this request as multipart/form-data');
  return parseMultipart(raw, marker.trim());
}

function parseMultipart(raw: Buffer, boundary: string): MultipartBody {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  const files: Record<string, MultipartFile> = {};

  let cursor = raw.indexOf(delimiter);
  while (cursor !== -1) {
    let start = cursor + delimiter.byteLength;
    if (raw.subarray(start, start + 2).toString() === '--') break;
    if (raw.subarray(start, start + 2).toString() === '\r\n') start += 2;

    const headerEnd = raw.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = raw.subarray(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextDelimiter = raw.indexOf(delimiter, bodyStart);
    const bodyEnd = nextDelimiter === -1 ? raw.byteLength : nextDelimiter - 2;
    const body = raw.subarray(bodyStart, Math.max(bodyStart, bodyEnd));

    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const partTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    const name = nameMatch?.[1];
    if (name !== undefined) {
      if (filenameMatch === undefined || filenameMatch === null) {
        fields[name] = body.toString('utf8');
      } else {
        if (body.byteLength > LIMITS.uploadFileBytes) {
          throw tooLarge('That file is too large');
        }
        files[name] = {
          filename: filenameMatch[1] ?? '',
          contentType: (partTypeMatch?.[1] ?? '').trim().toLowerCase(),
          bytes: body,
        };
      }
    }
    cursor = nextDelimiter;
  }
  return { fields, files };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.byteLength,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

export function sendRawJson(res: ServerResponse, status: number, body: string): void {
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.byteLength,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body());
}

export function sendBytes(
  res: ServerResponse,
  status: number,
  type: string,
  bytes: Uint8Array,
  cacheControl: string,
): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.byteLength,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(bytes);
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (header === undefined) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}
