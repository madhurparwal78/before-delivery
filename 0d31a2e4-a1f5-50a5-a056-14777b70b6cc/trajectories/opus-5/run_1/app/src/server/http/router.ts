import { AppError, fail } from '../errors.js';
import type { UserRow } from '../services/accounts.js';

export interface Reply {
  status: number;
  body?: unknown;
  cookie?: { value: string } | { clear: true };
  headers?: Record<string, string>;
}

export interface RequestContext {
  method: string;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  user: UserRow | null;
  sessionToken: string | null;
}

export type Handler = (ctx: RequestContext) => Promise<Reply>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  /** Gated endpoints need a verified email. */
  gated: boolean;
  /** Endpoints that need no session at all. */
  open: boolean;
}

export class Router {
  private readonly routes: Route[] = [];

  add(
    method: string,
    path: string,
    handler: Handler,
    options: { gated?: boolean; open?: boolean } = {},
  ): void {
    this.routes.push({
      method,
      segments: path.split('/').filter((part) => part.length > 0),
      handler,
      gated: options.gated ?? false,
      open: options.open ?? false,
    });
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((part) => part.length > 0);
    let pathExists = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i += 1) {
        const expected = route.segments[i];
        const actual = parts[i];
        if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
        else if (expected !== actual) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      pathExists = true;
      if (route.method === method) return { route, params };
    }
    if (pathExists) throw fail.notFound();
    return null;
  }

  async run(
    method: string,
    url: URL,
    body: Record<string, unknown>,
    user: UserRow | null,
    sessionToken: string | null,
  ): Promise<Reply> {
    const found = this.match(method, url.pathname);
    if (found === null) throw fail.notFound();
    const { route, params } = found;
    if (!route.open && user === null) throw fail.unauthenticated();
    if (route.gated && user !== null && !user.email_verified) throw fail.emailUnverified();
    return route.handler({ method, url, params, body, user, sessionToken });
  }
}

export function requireUser(ctx: RequestContext): UserRow {
  if (ctx.user === null) throw fail.unauthenticated();
  return ctx.user;
}

export function requireId(ctx: RequestContext, name: string): number {
  const raw = ctx.params[name];
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw fail.notFound();
  return value;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toAppError(error: unknown): AppError {
  return error instanceof AppError ? error : fail.internal();
}
