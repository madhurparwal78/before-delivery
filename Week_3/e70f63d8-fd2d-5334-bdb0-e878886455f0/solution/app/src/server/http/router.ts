import type { IncomingMessage, ServerResponse } from 'node:http';
import { copy } from '../../shared/copy.js';
import type { User } from '../../shared/wire.js';
import { JSON_LIMIT_BYTES } from '../config.js';
import type { BodyKind } from './body.js';
import { readBody } from './body.js';
import { ApiError, notFound } from './errors.js';

export interface Context {
  req: IncomingMessage;
  params: Record<string, string>;
  body: unknown;
  user: User | null;
}

export interface Reply {
  status: number;
  json?: unknown;
  raw?: { body: Buffer; type: string };
  headers?: Record<string, string | string[]>;
}

export const reply = (status: number, json?: unknown, headers?: Record<string, string | string[]>): Reply => ({ status, json, headers });

type Handler = (ctx: Context) => Promise<Reply>;

interface Route {
  method: string;
  matcher: RegExp;
  names: string[];
  auth: boolean;
  bodyKind: BodyKind;
  limit: number;
  handler: Handler;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

const routes: Route[] = [];

interface RouteOptions { auth?: boolean; body?: BodyKind; limit?: number }

/** Registers an API route. Path parameters named `id` or ending in `Id` must be UUIDs, otherwise the route answers 404. */
export const route = (method: string, pattern: string, options: RouteOptions, handler: Handler): void => {
  const names: string[] = [];
  const source = pattern.replace(/:(\w+)/g, (_, name: string) => { names.push(name); return '([^/]+)'; });
  routes.push({
    method, matcher: new RegExp(`^${source}$`), names, auth: options.auth ?? true, bodyKind: options.body ?? 'json',
    limit: options.limit ?? JSON_LIMIT_BYTES, handler,
  });
};

export const authedUser = (ctx: Context): User => {
  if (ctx.user === null) throw new ApiError(401, 'SIGN_IN_REQUIRED', copy.signInRequired);
  return ctx.user;
};

export const writeReply = (res: ServerResponse, result: Reply): void => {
  const headers: Record<string, string | string[]> = { 'X-Content-Type-Options': 'nosniff', ...result.headers };
  if (result.raw) {
    res.writeHead(result.status, { ...headers, 'Content-Type': result.raw.type, 'Content-Length': result.raw.body.length });
    res.end(result.raw.body);
    return;
  }
  if (result.json === undefined) {
    res.writeHead(result.status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(result.json));
  res.writeHead(result.status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length });
  res.end(payload);
};

export const errorReply = (error: ApiError): Reply => ({
  status: error.status,
  json: { error: { code: error.code, message: error.message, ...error.extra } },
  headers: error.status === 413 ? { Connection: 'close' } : undefined,
});

/** Runs the API route that matches, or answers null when none does. The error precedence starts here: body, then sign-in. */
export const dispatch = async (
  req: IncomingMessage, url: URL, resolveUser: () => Promise<User | null>,
): Promise<Reply | null> => {
  const method = req.method ?? 'GET';
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = candidate.matcher.exec(url.pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    candidate.names.forEach((name, index) => { params[name] = decodeURIComponent(match[index + 1] ?? ''); });
    try {
      const body = candidate.method === 'GET' || candidate.method === 'DELETE' ? undefined : await readBody(req, candidate.bodyKind, candidate.limit);
      const user = await resolveUser();
      const ctx: Context = { req, params, body, user };
      if (candidate.auth) authedUser(ctx);
      for (const [name, value] of Object.entries(params)) {
        if ((name === 'id' || name.endsWith('Id')) && !isUuid(value)) throw notFound();
      }
      return await candidate.handler(ctx);
    } catch (error) {
      if (error instanceof ApiError) return errorReply(error);
      throw error;
    }
  }
  return null;
};
