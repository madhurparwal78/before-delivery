import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_BODY_LIMIT, SYNC_BODY_LIMIT } from './config.js';
import { ApiError, crossOrigin, tooLarge, unsupportedMediaType } from './errors.js';

export interface Reply {
  status: number;
  body: Uint8Array | null;
  headers: Record<string, string>;
}

export function jsonReply(status: number, value: unknown, extra: Record<string, string> = {}): Reply {
  return {
    status,
    body: new Uint8Array(Buffer.from(JSON.stringify(value), 'utf8')),
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  };
}

export function bytesReply(
  status: number,
  bytes: Uint8Array,
  contentType: string,
  extra: Record<string, string> = {},
): Reply {
  return { status, body: bytes, headers: { 'content-type': contentType, ...extra } };
}

export function emptyReply(status: number, extra: Record<string, string> = {}): Reply {
  return { status, body: null, headers: extra };
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function bodyLimitFor(pathname: string): number {
  return pathname === '/api/sync' ? SYNC_BODY_LIMIT : DEFAULT_BODY_LIMIT;
}

/** Read the body, refusing anything past the route's limit. */
export async function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) {
    request.resume();
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > limit) {
      request.destroy();
      throw tooLarge();
    }
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * The boundary checks, in the published error precedence: too large, wrong
 * content type, then cross origin.
 */
export function checkContentType(request: IncomingMessage, bodyLength: number): void {
  if (bodyLength === 0) return;
  const raw = request.headers['content-type'];
  const type = (raw ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw unsupportedMediaType();
}

export function checkOrigin(request: IncomingMessage): void {
  const method = (request.method ?? 'GET').toUpperCase();
  if (!STATE_CHANGING.has(method)) return;
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = request.headers.host;
  if (host === undefined) throw crossOrigin();
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw crossOrigin();
  }
  if (parsed.host !== host) throw crossOrigin();
}

export function parseJsonBody(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.byteLength === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new ApiError(422, 'validation', { fields: {} });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(422, 'validation', { fields: {} });
  }
  return parsed as Record<string, unknown>;
}

export function writeReply(response: ServerResponse, reply: Reply): void {
  const headers = { ...reply.headers };
  if (reply.body) headers['content-length'] = String(reply.body.byteLength);
  response.writeHead(reply.status, headers);
  if (reply.body) response.end(Buffer.from(reply.body));
  else response.end();
}
