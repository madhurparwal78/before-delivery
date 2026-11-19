import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, Err } from './errors.js';

export type BodyMode = 'none' | 'json' | 'bytes';

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string>;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  json: Record<string, unknown>;
  bytes: Buffer;
  contentType: string;
  cookies: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<Reply | void>;

export interface Route {
  method: string;
  pattern: string;
  body: BodyMode;
  limit: number;
  handler: Handler;
}

export const LIMITS = {
  json: 1_000_000,
  model: 20_000_000,
  texture: 8_000_000,
  importZip: 50_000_000,
} as const;

export function route(
  method: string,
  pattern: string,
  body: BodyMode,
  handler: Handler,
  limit: number = LIMITS.json,
): Route {
  return { method, pattern, body, limit, handler };
}

interface Matched {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(routes: Route[], method: string, path: string): Matched | 'no-path' | 'no-method' {
  const parts = path.split('/').filter((p) => p.length > 0);
  let pathMatched = false;
  for (const candidate of routes) {
    const patternParts = candidate.pattern.split('/').filter((p) => p.length > 0);
    if (patternParts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i += 1) {
      const expected = patternParts[i] as string;
      const actual = parts[i] as string;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (candidate.method !== method) continue;
    return { route: candidate, params };
  }
  return pathMatched ? 'no-method' : 'no-path';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw Err.tooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw Err.tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isJsonContentType(value: string): boolean {
  const base = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'application/json';
}

export async function buildContext(
  req: IncomingMessage,
  res: ServerResponse,
  matched: Matched,
  url: URL,
): Promise<Ctx> {
  const contentType = req.headers['content-type'] ?? '';
  let bytes: Buffer = Buffer.alloc(0);
  let json: Record<string, unknown> = {};
  if (matched.route.body !== 'none') {
    bytes = await readBody(req, matched.route.limit);
  }
  if (matched.route.body === 'json') {
    if (bytes.length > 0 || contentType !== '') {
      if (!isJsonContentType(contentType)) throw Err.unsupportedMediaType();
    }
    if (bytes.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString('utf8'));
      } catch {
        throw Err.badJson();
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw Err.badJson();
      json = parsed as Record<string, unknown>;
    }
  }
  return {
    req,
    res,
    method: req.method ?? 'GET',
    path: url.pathname,
    params: matched.params,
    query: url.searchParams,
    json,
    bytes,
    contentType,
    cookies: parseCookies(req.headers['cookie']),
  };
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Same-origin only: a write from another origin is refused. */
export function checkOrigin(req: IncomingMessage): void {
  const method = req.method ?? 'GET';
  if (!WRITE_METHODS.has(method)) return;
  const origin = req.headers['origin'];
  if (origin === undefined || origin === 'null') return;
  const host = req.headers['host'];
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw Err.forbidden();
  }
  if (originHost !== host) throw Err.forbidden();
}

export function sendReply(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  let payload: Buffer;
  if (reply.json !== undefined) {
    payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
  } else if (reply.body !== undefined) {
    payload = typeof reply.body === 'string' ? Buffer.from(reply.body, 'utf8') : reply.body;
  } else {
    payload = Buffer.alloc(0);
  }
  headers['Content-Length'] = String(payload.length);
  headers['X-Content-Type-Options'] = 'nosniff';
  res.writeHead(reply.status, headers);
  if (payload.length > 0) res.end(payload);
  else res.end();
}

export function sendError(res: ServerResponse, error: unknown): void {
  const apiError =
    error instanceof ApiError ? error : new ApiError(500, 'internal_error', 'Something went wrong');
  if (!(error instanceof ApiError)) {
    console.error('request failed', error instanceof Error ? error.message : error);
  }
  sendReply(res, { status: apiError.status, json: apiError.body() });
}

export function sessionCookie(token: string): string {
  const maxAge = 30 * 24 * 60 * 60;
  return `ag_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedSessionCookie(): string {
  return 'ag_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
