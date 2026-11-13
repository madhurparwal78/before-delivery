import { ERRORS, HttpError, type Ctx, type Send } from './http';

export interface Handler {
  (ctx: Ctx): Promise<unknown | { __status: number; __body: unknown; __headers?: Record<string, string> } | void>;
}

export interface RouteSpec {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  needsJsonBody?: boolean;
  staff?: boolean;
  handler: Handler;
}

export interface StaffSession {
  userId: string;
  gameId: string;
  role: 'developer' | 'moderator';
  familyId: string;
  changeToken: string;
  jti: string;
}

export function route(method: string, path: string, handler: Handler, options: { needsJsonBody?: boolean } = {}): RouteSpec {
  const names: string[] = [];
  const source = path.replace(/:([A-Za-z0-9_]+)/g, (_match, name) => {
    names.push(name);
    return '([^/]+)';
  });
  const pattern = new RegExp(`^${source}$`);
  return { method, pattern, paramNames: names, needsJsonBody: options.needsJsonBody, handler };
}

export function wrap(handler: Handler): (ctx: Ctx) => Promise<void> {
  return async (ctx: Ctx) => {
    const result = await handler(ctx);
    if (result === undefined) return;
    if (result && typeof result === 'object' && '__status' in result) {
      const payload = result as { __status: number; __body: unknown; __headers?: Record<string, string> };
      ctx.send(payload.__body, payload.__status, payload.__headers);
      return;
    }
    ctx.send(result, 200);
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function requireJsonContent(ctx: Ctx): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw ERRORS.unsupportedMedia();
  }
}

export function assertSameOrigin(ctx: Ctx): void {
  const origin = ctx.req.headers.origin;
  if (!origin) return;
  const host = ctx.req.headers.host ?? new URL(ctx.url.toString()).host;
  const allowed = new URL(ctx.url.protocol + '//' + host).origin;
  if (origin !== allowed) throw ERRORS.changeRefused();
}

export function ok(body: unknown, status = 200, headers?: Record<string, string>): { __status: number; __body: unknown; __headers?: Record<string, string> } {
  return { __status: status, __body: body, __headers: headers };
}

export function noContent(): { __status: number; __body: unknown } {
  return { __status: 204, __body: undefined };
}
