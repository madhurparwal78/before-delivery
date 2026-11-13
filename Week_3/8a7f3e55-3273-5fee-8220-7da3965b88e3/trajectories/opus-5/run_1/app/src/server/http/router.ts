import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionUser } from '../../shared/api.js';

export interface JsonResult {
  status: number;
  body?: unknown;
}

export interface RequestContext {
  method: string;
  path: string;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  rawBody: Buffer;
  contentType: string;
  user: SessionUser | null;
  now: Date;
  req: IncomingMessage;
  res: ServerResponse;
  setSessionCookie: (token: string | null) => void;
}

export function actor(ctx: RequestContext): SessionUser {
  if (ctx.user === null) throw new Error('Route requires a signed-in actor');
  return ctx.user;
}

export interface Route {
  method: string;
  pattern: string;
  segments: string[];
  anonymous: boolean;
  idempotent: boolean;
  raw: boolean;
  handler: (ctx: RequestContext) => Promise<JsonResult>;
}

export interface RouteOptions {
  anonymous?: boolean;
  idempotent?: boolean;
  raw?: boolean;
}

const routes: Route[] = [];

export function route(
  method: string,
  pattern: string,
  handler: (ctx: RequestContext) => Promise<JsonResult>,
  options: RouteOptions = {},
): void {
  routes.push({
    method,
    pattern,
    segments: pattern.split('/').filter((segment) => segment.length > 0),
    anonymous: options.anonymous ?? false,
    idempotent: options.idempotent ?? false,
    raw: options.raw ?? false,
    handler,
  });
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(method: string, path: string): RouteMatch | null {
  const parts = path.split('/').filter((segment) => segment.length > 0);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, segment] of candidate.segments.entries()) {
      const actual = parts[index] ?? '';
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(actual);
      else if (segment !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}
