import type { IncomingMessage, ServerResponse } from 'node:http';
import { now } from './clock.js';

export const JSON_LIMIT = 1000000;

export interface SessionUser {
  id: string;
  username: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly fields?: Record<string, string> | { line: number | null; message: string }[],
    public readonly extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export function fail(status: number, code: string, fields?: ApiError['fields'], extra?: Record<string, unknown>): never {
  throw new ApiError(status, code, fields, extra);
}

export function notFound(): never {
  return fail(404, 'not_found');
}

export function forbidden(): never {
  return fail(403, 'forbidden');
}

export function unauthenticated(): never {
  return fail(401, 'unauthenticated');
}

export function invalid(fields: Record<string, string>): never {
  return fail(422, 'invalid', fields);
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  url: URL;
  user: SessionUser | null;
  body: () => Promise<unknown>;
  raw: () => Promise<Buffer>;
  setCookie: (value: string) => void;
}

export function requireUser(ctx: Ctx): SessionUser {
  if (ctx.user === null) unauthenticated();
  return ctx.user;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function sendError(res: ServerResponse, err: ApiError): void {
  const body: Record<string, unknown> = { error: err.code };
  if (err.fields !== undefined) body.errors = err.fields;
  if (err.extra !== undefined) Object.assign(body, err.extra);
  const headers: Record<string, string> = {};
  if (err.status === 429 && err.extra !== undefined && typeof err.extra.retry_after === 'number') {
    headers['retry-after'] = String(err.extra.retry_after);
    delete body.retry_after;
  }
  sendJson(res, err.status, body, headers);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

const buckets = new Map<string, { minute: number; count: number }>();

export function rateLimit(key: string, max: number): void {
  const ms = now().getTime();
  const minute = Math.floor(ms / 60000);
  const current = buckets.get(key);
  if (current === undefined || current.minute !== minute) {
    buckets.set(key, { minute, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > max) {
    const retry = Math.max(1, Math.ceil(((minute + 1) * 60000 - ms) / 1000));
    fail(429, 'rate_limited', undefined, { retry_after: retry });
  }
}

export type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, parts: path.split('/').filter((p) => p !== ''), handler });
  }

  get(path: string, handler: Handler): void {
    this.add('GET', path, handler);
  }

  post(path: string, handler: Handler): void {
    this.add('POST', path, handler);
  }

  put(path: string, handler: Handler): void {
    this.add('PUT', path, handler);
  }

  patch(path: string, handler: Handler): void {
    this.add('PATCH', path, handler);
  }

  delete(path: string, handler: Handler): void {
    this.add('DELETE', path, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((p) => p !== '');
    for (const route of this.routes) {
      if (route.parts.length !== parts.length || route.method !== method) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i += 1) {
        const expect = route.parts[i];
        if (expect.startsWith(':')) {
          params[expect.slice(1)] = decodeURIComponent(parts[i]);
          continue;
        }
        if (expect !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) {
      req.destroy();
      fail(413, 'too_large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}


export function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

export function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
