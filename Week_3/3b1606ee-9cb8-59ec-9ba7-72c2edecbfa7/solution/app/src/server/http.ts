import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountRow } from './rows.js';

export const JSON_LIMIT = 131_072;
const DISCARD_LIMIT = 8 * 1024 * 1024;

/** The one error type; `sendError` is the one place an error body is built. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const invalid = (fields: Record<string, string>): ApiError => new ApiError(422, 'invalid', { fields });

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function sendReply(res: ServerResponse, reply: Reply): void {
  if (res.headersSent || res.destroyed) return;
  const payload = reply.body === undefined ? '' : JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...reply.headers,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendReply(res, { status: error.status, body: { error: error.code, ...error.extra } });
}

export interface OpenContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Buffer;
}

export interface AuthedContext extends OpenContext {
  account: AccountRow;
  sessionHash: Buffer;
}

/** `handled` means the handler already wrote the response (streamed blob bytes). */
export type Outcome = Reply | 'handled';

interface RouteBase {
  method: string;
  pattern: RegExp;
  keys: string[];
}
type OpenRoute = RouteBase & { auth: false; raw: boolean; handler: (ctx: OpenContext) => Promise<Outcome> };
type AuthedRoute = RouteBase & { auth: true; raw: boolean; handler: (ctx: AuthedContext) => Promise<Outcome> };
type Route = OpenRoute | AuthedRoute;

const routes: Route[] = [];

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_match, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function open(method: string, path: string, handler: OpenRoute['handler']): void {
  routes.push({ method, ...compile(path), auth: false, raw: false, handler });
}

export function authed(method: string, path: string, handler: AuthedRoute['handler']): void {
  routes.push({ method, ...compile(path), auth: true, raw: false, handler });
}

/** A signed-in route that reads its own request body (blob content). */
export function authedRaw(method: string, path: string, handler: AuthedRoute['handler']): void {
  routes.push({ method, ...compile(path), auth: true, raw: true, handler });
}

export function findRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    try {
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] ?? '');
      });
    } catch {
      return null;
    }
    return { route, params };
  }
  return null;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else over = true;
      if (size > DISCARD_LIMIT) {
        req.destroy();
        break;
      }
    }
  } catch {
    throw new ApiError(400, 'bad_request');
  }
  if (over) throw new ApiError(413, 'too_large');
  return Buffer.concat(chunks);
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function isStateChanging(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export function hasJsonContentType(req: IncomingMessage): boolean {
  return /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '');
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}
