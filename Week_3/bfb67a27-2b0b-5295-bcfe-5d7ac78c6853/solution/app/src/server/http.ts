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
  if (origin === undefined) return;
  try {
    const protocol = 'encrypted' in req.socket && req.socket.encrypted ? 'https:' : 'http:';
    if (new URL(origin).origin === `${protocol}//${req.headers.host}`) return;
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
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let exceeded = false;
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > limit) {
        if (!exceeded) reject(tooLarge('That request is too large'));
        exceeded = true;
        chunks.length = 0;
      } else if (!exceeded) chunks.push(chunk);
    });
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

interface JsonRequest {
  raw: string;
  preview: () => Record<string, unknown> | null;
  parse: () => Record<string, unknown>;
}

/** Read size and media type first; callers parse only at validation's rung. */
export async function readJsonBody(req: IncomingMessage, allowEmpty = false): Promise<JsonRequest> {
  const raw = await readBody(req, LIMITS.jsonBodyBytes);
  if (contentType(req) !== 'application/json' && !(allowEmpty && raw.byteLength === 0 && contentType(req) === '')) {
    throw unsupportedMediaType('Send this request as application/json');
  }
  return {
    raw: raw.toString('utf8'),
    preview: () => {
      try {
        const value: unknown = JSON.parse(raw.toString('utf8'));
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
      } catch { return null; }
    },
    parse: () => {
      if (raw.byteLength === 0) return {};
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString('utf8')); }
      catch { throw validation({ body: 'Send a JSON object' }); }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw validation({ body: 'Send a JSON object' });
      }
      return parsed as Record<string, unknown>;
    },
  };
}

interface MultipartFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

interface MultipartBody {
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

  const findDelimiter = (from: number): number => {
    let index = raw.indexOf(delimiter, from);
    while (index !== -1) {
      const framed = index === 0 || raw.subarray(index - 2, index).toString() === '\r\n';
      const end = index + delimiter.byteLength;
      const suffix = raw.subarray(end, end + 2).toString();
      const closing = suffix === '--' && (end + 2 === raw.byteLength || raw.subarray(end + 2, end + 4).toString() === '\r\n');
      if (framed && (suffix === '\r\n' || closing)) return index;
      index = raw.indexOf(delimiter, index + 1);
    }
    return -1;
  };
  let cursor = findDelimiter(0);
  while (cursor !== -1) {
    let start = cursor + delimiter.byteLength;
    if (raw.subarray(start, start + 2).toString() === '--') break;
    if (raw.subarray(start, start + 2).toString() === '\r\n') start += 2;

    const headerEnd = raw.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = raw.subarray(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextDelimiter = findDelimiter(bodyStart);
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
    try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); }
    catch { continue; }
  }
  return cookies;
}
