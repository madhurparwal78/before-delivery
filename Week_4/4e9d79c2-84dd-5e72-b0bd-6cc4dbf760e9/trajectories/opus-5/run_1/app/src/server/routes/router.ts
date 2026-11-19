import { Ctx, checkOrigin, parseJson } from '../http.js';
import { AppError, JSON_BODY_LIMIT, methodNotAllowed, notFound } from '../errors.js';
import { requireDesk } from '../session.js';

export type Access = 'public' | 'session' | 'private';

export type Route = {
  method: string;
  pattern: string;
  access: Access;
  limit: number;
  handler: (ctx: Ctx) => Promise<void>;
  rate?: (ctx: Ctx) => Promise<void>;
};

export function route(
  method: string,
  pattern: string,
  access: Access,
  handler: (ctx: Ctx) => Promise<void>,
  options: { limit?: number; rate?: (ctx: Ctx) => Promise<void> } = {},
): Route {
  return { method, pattern, access, handler, limit: options.limit ?? JSON_BODY_LIMIT, rate: options.rate };
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function match(pattern: string, path: string): Record<string, string> | null {
  const wanted = pattern.split('/');
  const given = path.split('/');
  if (wanted.length !== given.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < wanted.length; index += 1) {
    const part = wanted[index];
    if (part.startsWith(':')) {
      if (given[index] === '') return null;
      params[part.slice(1)] = given[index];
      continue;
    }
    if (part !== given[index]) return null;
  }
  return params;
}

export async function dispatch(routes: Route[], ctx: Ctx): Promise<boolean> {
  const samePath: Route[] = [];
  for (const candidate of routes) {
    const params = match(candidate.pattern, ctx.path);
    if (!params) continue;
    samePath.push(candidate);
    if (candidate.method !== ctx.method) continue;
    ctx.params = params;
    await run(candidate, ctx);
    return true;
  }
  if (samePath.length > 0) {
    throw methodNotAllowed([...new Set(samePath.map((found) => found.method))].sort().join(', '));
  }
  return false;
}

async function run(found: Route, ctx: Ctx): Promise<void> {
  if (BODY_METHODS.has(ctx.method)) {
    await ctx.body(found.limit);
  }
  if (found.rate) await found.rate(ctx);
  checkOrigin(ctx);
  if (found.access === 'session') requireDesk(ctx);
  await found.handler(ctx);
}

export async function jsonBody(ctx: Ctx, limit = JSON_BODY_LIMIT): Promise<Record<string, unknown>> {
  const raw = await ctx.body(limit);
  return parseJson(raw, ctx);
}

export function pathParam(ctx: Ctx, name: string): string {
  const value = ctx.params[name];
  if (!value) throw notFound();
  return value;
}

export function assertKnown<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw notFound();
  return value;
}

export function isAppError(trouble: unknown): trouble is AppError {
  return trouble instanceof AppError;
}
