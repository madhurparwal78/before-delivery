import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import { forbidden, unauthenticated } from '../copy';
import type { Actor, Role } from '../domain/types';

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
  raw: Buffer;
  res: ServerResponse;
  token: string | null;
  actor: Actor | null;
}

export type Reply =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'empty'; status: number }
  | { kind: 'bytes'; status: number; contentType: string; body: Buffer };

export const json = (status: number, body: unknown): Reply => ({ kind: 'json', status, body });
export const empty = (status: number): Reply => ({ kind: 'empty', status });
export const bytes = (contentType: string, body: Buffer): Reply => ({
  kind: 'bytes',
  status: 200,
  contentType,
  body,
});

export interface Route {
  method: string;
  pattern: string[];
  handler: (ctx: Ctx) => Promise<Reply>;
}

export function route(method: string, path: string, handler: (ctx: Ctx) => Promise<Reply>): Route {
  return { method, pattern: path.split('/').filter((s) => s !== ''), handler };
}

export function match(routes: readonly Route[], method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const segments = path.split('/').filter((s) => s !== '');
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < segments.length; i += 1) {
      const piece = candidate.pattern[i];
      if (piece.startsWith(':')) params[piece.slice(1)] = decodeURIComponent(segments[i]);
      else if (piece !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: candidate, params };
  }
  return null;
}

export function requireActor(ctx: Ctx): Actor {
  if (ctx.actor === null) throw unauthenticated();
  return ctx.actor;
}

export function requireRole(ctx: Ctx, ...roles: Role[]): Actor {
  const actor = requireActor(ctx);
  if (!roles.includes(actor.role)) throw forbidden();
  return actor;
}
