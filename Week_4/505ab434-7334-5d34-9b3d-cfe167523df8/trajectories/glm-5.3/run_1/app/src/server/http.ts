import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, invalidBody, notFound, tooLarge, unauthenticated, crossOrigin } from './errors';
import { verifySession } from './sessions';
import type { Tx } from './db';
import { withTransaction, query, type QueryResultRow } from './db';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Principal {
  id: string;
  email: string;
  displayName: string;
  role: string;
  organisationId: string | null;
}

export interface Body {
  json: unknown;
  file?: { fileName: string; bytes: Buffer };
  fields: Record<string, string>;
}

export interface Ctx {
  method: Method;
  path: string;
  params: Record<string, string>;
  url: URL;
  principal: Principal | null;
  body: Body;
  cookies: Record<string, string>;
  setCookies: string[];
  req: IncomingMessage;
  res: ServerResponse;
  tx: Tx | null;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;
export type PageHandler = (ctx: Ctx) => Promise<{ status: number; html: string } | { redirect: string }>;

interface Route {
  method: Method;
  segments: string[];
  handler: Handler;
}

export const JSON_LIMIT = 100000;

export class Router {
  private routes: Route[] = [];

  add(method: Method, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter((s) => s.length > 0), handler });
  }

  find(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = path.split('/').filter((s) => s.length > 0);
    outer: for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
        } else if (seg !== parts[i]) {
          continue outer;
        }
      }
      return { handler: route.handler, params };
    }
    return null;
  }
}

export function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

const BOUNDARY_RE = /boundary="?([^";]+)"?/i;

export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) throw tooLarge();
    chunks.push(buf);
  }
  const buffer = Buffer.concat(chunks);
  const contentType = String(req.headers['content-type'] ?? '');
  if (contentType.includes('application/json')) {
    if (buffer.length > JSON_LIMIT) throw tooLarge();
    if (buffer.length === 0) return { json: null, fields: {} };
    try {
      return { json: JSON.parse(buffer.toString('utf8')), fields: {} };
    } catch {
      throw invalidBody();
    }
  }
  if (contentType.startsWith('multipart/form-data')) {
    const m = BOUNDARY_RE.exec(contentType);
    if (!m) throw invalidBody();
    const boundary = `--${m[1]}`;
    return parseMultipart(buffer, boundary);
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const fields: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(buffer.toString('utf8'))) fields[k] = v;
    return { json: fields, fields };
  }
  return { json: null, fields: {} };
}

function parseMultipart(buffer: Buffer, boundary: string): Body {
  const fields: Record<string, string> = {};
  let file: { fileName: string; bytes: Buffer } | undefined;
  const sep = Buffer.from(boundary);
  let pos = buffer.indexOf(sep);
  while (pos >= 0) {
    const next = buffer.indexOf(sep, pos + sep.length);
    if (next < 0) break;
    let part = buffer.slice(pos + sep.length, next);
    if (part[0] === 13 && part[1] === 10) part = part.slice(2);
    while (part.length > 0 && (part[part.length - 1] === 13 || part[part.length - 1] === 10)) {
      part = part.slice(0, part.length - 1);
    }
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const head = part.slice(0, headerEnd).toString('utf8');
      const content = part.slice(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(head);
      const fileMatch = /filename="([^"]*)"/.exec(head);
      const name = nameMatch ? nameMatch[1] : '';
      if (fileMatch) {
        file = { fileName: fileMatch[1], bytes: content };
      } else if (name) {
        fields[name] = content.toString('utf8');
      }
    }
    pos = next;
  }
  return { json: null, fields, file };
}

export function originAllowed(req: IncomingMessage, appOrigin: string, method: Method): boolean {
  if (method === 'GET') return true;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return origin === appOrigin;
}

export async function resolvePrincipal(req: IncomingMessage, cookieName: string): Promise<Principal | null> {
  const cookies = readCookies(req.headers.cookie);
  const token = cookies[cookieName];
  if (!token) return null;
  return verifySession(token);
}

/** Runs a handler inside one transaction when it needs writes. */
export async function inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTransaction(fn);
}

export async function one<T extends QueryResultRow>(sql: string, params: readonly unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function json(res: ServerResponse, status: number, value: unknown, setCookies: string[] = []): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...(setCookies.length > 0 ? { 'set-cookie': setCookies } : {}),
  });
  res.end(body);
}

export function errorResponse(res: ServerResponse, err: unknown, setCookies: string[] = []): void {
  if (err instanceof ApiError) {
    json(res, err.status, { error: err.code, message: err.message }, setCookies);
    return;
  }
  console.error('unhandled error', err);
  json(res, 500, { error: 'internal', message: 'Something went wrong.' }, setCookies);
}

export function requireSession(ctx: Ctx): Principal {
  if (!ctx.principal) throw unauthenticated();
  return ctx.principal;
}

export { notFound, crossOrigin };
