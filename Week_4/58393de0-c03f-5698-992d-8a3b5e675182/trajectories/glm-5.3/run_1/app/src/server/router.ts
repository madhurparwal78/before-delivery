import type pg from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from './config.js';
import type { SessionRow } from './sessions.js';
import type { ApiErrorBody } from './apiError.js';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  pool: pg.Pool;
  cfg: ServerConfig;
  url: URL;
  method: string;
  body: unknown;
  rawBody: Buffer;
  session: SessionRow | null;
  accountId: string | null;
  kind: SessionRow['kind'] | 'none';
  ip: string;
  params: Record<string, string>;
}

export type HandlerResult =
  | { status: number; body?: unknown; headers?: Record<string, string | number> }
  | { status: number; body: ApiErrorBody; headers?: Record<string, string | number> };

export type Handler = (ctx: Ctx) => Promise<HandlerResult | undefined | void>;

export interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replaceAll(/:([A-Za-z]+)/g, (_m, key: string) => {
    keys.push(key);
    return '([^/]+)';
  }) + '$');
  return { method, pattern, keys, handler };
}

export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]!); });
    return { route: r, params };
  }
  return null;
}
