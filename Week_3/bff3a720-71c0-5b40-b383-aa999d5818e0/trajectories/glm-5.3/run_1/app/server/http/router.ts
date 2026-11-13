import type { IncomingMessage, ServerResponse } from 'http';
import { ApiError } from './errors.js';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  rawBody: Buffer;
  cookies: Record<string, string>;
  memberId: string | null;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  needsMember: boolean;
  json: boolean;
}

export class Router {
  #routes: Route[] = [];

  add(method: string, path: string, handler: Handler, opts: { member?: boolean; json?: boolean } = {}): void {
    const paramNames: string[] = [];
    const source = path
      .split('/')
      .map(seg => {
        if (seg.startsWith(':')) {
          paramNames.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.#routes.push({
      method,
      pattern: new RegExp(`^${source}$`),
      paramNames,
      handler,
      needsMember: opts.member ?? true,
      json: opts.json ?? true,
    });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.#routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return null;
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(text)),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendError(res: ServerResponse, e: unknown): void {
  if (e instanceof ApiError) {
    sendJson(res, e.status, e.body(), e.headers ?? {});
    return;
  }
  console.error('internal error', e);
  sendJson(res, 500, { error: 'internal', message: 'Something went wrong.' });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
