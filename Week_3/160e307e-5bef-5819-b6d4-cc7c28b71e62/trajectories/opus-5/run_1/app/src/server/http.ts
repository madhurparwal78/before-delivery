import type { IncomingMessage, ServerResponse } from 'node:http';
import { env } from './env.js';
import { ApiError } from './errors.js';
import { DatabaseUnavailable } from './db.js';

export const JSON_BODY_LIMIT = 65536;
export const LOCAL_MATCH_BODY_LIMIT = 1000000;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  path: string;
  params: Record<string, string>;
  body: Record<string, unknown>;
  cookies: Record<string, string>;
  sessionId: string | null;
  setSession: (id: string) => void;
}

type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  pattern: string[];
  handler: Handler;
  bodyLimit: number;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, bodyLimit = JSON_BODY_LIMIT): void {
    this.routes.push({ method, pattern: path.split('/').filter(Boolean), handler, bodyLimit });
  }

  get(path: string, handler: Handler): void {
    this.add('GET', path, handler);
  }

  post(path: string, handler: Handler, bodyLimit?: number): void {
    this.add('POST', path, handler, bodyLimit);
  }

  delete(path: string, handler: Handler): void {
    this.add('DELETE', path, handler);
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.pattern.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i += 1) {
        const token = route.pattern[i];
        if (token.startsWith(':')) params[token.slice(1)] = decodeURIComponent(parts[i]);
        else if (token !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  limitFor(method: string, path: string): number {
    return this.match(method, path)?.route.bodyLimit ?? JSON_BODY_LIMIT;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, { 'cache-control': 'no-store' });
  res.end();
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(res, error.status, error.body());
    return;
  }
  if (error instanceof DatabaseUnavailable) {
    sendJson(res, 503, { error: 'DATABASE_UNAVAILABLE' });
    return;
  }
  sendJson(res, 500, { error: 'SERVER_ERROR' });
}

/** A state-changing request from another origin is refused. */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  const host = req.headers.host;
  if (host === undefined) return false;
  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }
  if (candidate.host === host) return true;
  try {
    return candidate.host === new URL(env.appPublicUrl).host;
  } catch {
    return false;
  }
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function parseJsonBody(raw: Buffer, contentType: string | undefined): Record<string, unknown> {
  if (raw.length === 0) return {};
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(400, 'INVALID_PAYLOAD');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_PAYLOAD');
  }
  return parsed as Record<string, unknown>;
}

export function sessionCookie(id: string): string {
  return `dc_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

export function str(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

export function num(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function bool(body: Record<string, unknown>, key: string): boolean | null {
  const value = body[key];
  return typeof value === 'boolean' ? value : null;
}
