import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, malformedJson, tooLarge, unsupportedMediaType } from './errors.js';

export const SESSION_COOKIE = 'twig_session';

export interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  url: URL;
  request: IncomingMessage;
  response: ServerResponse;
  cookies: Record<string, string>;
  body: () => Record<string, unknown>;
}

export function readCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

/** Reads a request body, refusing anything over the route's limit. */
export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function requireJsonType(request: IncomingMessage, raw: Buffer): void {
  if (raw.length === 0) return;
  const type = String(request.headers['content-type'] ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  if (type !== 'application/json') throw unsupportedMediaType();
}

export function parseJsonBody(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw malformedJson();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw malformedJson();
  return parsed as Record<string, unknown>;
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    ...headers
  });
  response.end(payload);
}

export function sendEmpty(
  response: ServerResponse,
  status: number,
  headers: Record<string, string> = {}
): void {
  response.writeHead(status, { 'cache-control': 'no-store', ...headers });
  response.end();
}

export function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(response, error.status, error.body);
    return;
  }
  sendJson(response, 500, { error: 'server_error' });
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
