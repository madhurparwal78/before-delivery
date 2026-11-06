import type { Role } from '../../shared/domain.ts';
import { ApiError } from './errors.ts';
import type { Ctx } from './context.ts';

export type Access = 'anyone' | 'session' | 'patron' | Role;

export type Route = {
  method: string;
  pattern: string;
  access: Access;
  handler: (ctx: Ctx) => Promise<void>;
};

const routes: Route[] = [];

export function route(method: string, pattern: string, access: Access, handler: (ctx: Ctx) => Promise<void>): void {
  routes.push({ method, pattern, access, handler });
}

function match(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

function assertAccess(ctx: Ctx, access: Access): void {
  if (access === 'anyone') return;
  if (ctx.account === null) throw new ApiError('unauthenticated');
  if (access === 'session') return;
  if (access === 'patron') {
    if (ctx.account.role !== 'patron') throw new ApiError('forbidden');
    return;
  }
  if (ctx.account.role !== access) throw new ApiError('forbidden');
}

export async function dispatch(ctx: Ctx): Promise<boolean> {
  const pathMatches: Route[] = [];
  for (const candidate of routes) {
    const params = match(candidate.pattern, ctx.path);
    if (params === null) continue;
    pathMatches.push(candidate);
    if (candidate.method !== ctx.method) continue;
    ctx.params = params;
    assertAccess(ctx, candidate.access);
    await candidate.handler(ctx);
    return true;
  }
  if (pathMatches.length > 0) {
    assertAccess(ctx, pathMatches[0].access);
    throw new ApiError('method_not_allowed');
  }
  return false;
}
