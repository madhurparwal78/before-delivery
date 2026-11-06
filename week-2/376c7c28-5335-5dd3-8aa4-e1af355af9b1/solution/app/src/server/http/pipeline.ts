import { actorForSession, readCookie } from '../auth.ts';
import { ApiError } from './errors.ts';
import { checkOrigin, readJsonBody, readMultipartBody } from './boundary.ts';
import { bodyFingerprint, claim, requireKey } from './idempotency.ts';
import { Ctx, type Route, type RouteResult } from './context.ts';

interface Match {
  readonly route: Route;
  readonly params: Record<string, string>;
}

let table: readonly Route[] = [];

export function useRoutes(routes: readonly Route[]): void {
  table = routes;
}

function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function matchRoute(method: string, path: string): Match | null {
  const parts = path.split('/').slice(1);
  for (const route of table) {
    if (route.method !== method) continue;
    const pattern = route.pattern.split('/').slice(1);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const expected = pattern[index] as string;
      const actual = parts[index] as string;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeSegment(actual);
      } else if (expected !== actual) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

function roleAllows(route: Route, ctx: Ctx): boolean {
  if (route.role === 'anyone' || route.role === 'signed_in') return true;
  const actor = ctx.actorOrFail;
  if (route.role === 'owner') return actor.role === 'owner';
  if (route.role === 'staff') return actor.role === 'owner' || actor.role === 'kiln_tech';
  return actor.role === 'member';
}

export async function runApi(ctx: Ctx): Promise<RouteResult> {
  // 1. Server-boundary refusals.
  checkOrigin(ctx);
  const match = matchRoute(ctx.method, ctx.path);
  const route = match?.route ?? null;
  if (route?.bodyMode === 'multipart') await readMultipartBody(ctx);
  else await readJsonBody(ctx);
  if (!route || !match) throw new ApiError('not_found');
  ctx.params = match.params;

  // 3. Session.
  if (route.role !== 'anyone') {
    const sessionId = readCookie(ctx.header('cookie'), 'kd_session');
    ctx.actor = await actorForSession(sessionId);
    if (!ctx.actor) throw new ApiError('unauthenticated');
  } else {
    const sessionId = readCookie(ctx.header('cookie'), 'kd_session');
    if (sessionId !== '') ctx.actor = await actorForSession(sessionId);
  }

  // 4 and 5. Path ids, invite tokens and records the caller may not see.
  if (route.resolve) await route.resolve(ctx);

  // 6. Role.
  if (!roleAllows(route, ctx)) throw new ApiError('forbidden');

  if (!route.idempotent) return route.handle(ctx);

  // 7 and 8. Idempotency.
  const actor = ctx.actorOrFail;
  const key = requireKey(ctx.header('idempotency-key'));
  const fingerprint = bodyFingerprint(route.pattern, ctx.json);
  const held = await claim(actor.studio.id, key, fingerprint);
  if (held.replay) return held.replay;
  let result: RouteResult;
  try {
    result = await route.handle(ctx);
  } catch (error) {
    if (error instanceof ApiError) {
      await held.finish({ status: error.status, body: error.body() });
    } else {
      await held.finish({ status: 500 });
    }
    throw error;
  }
  await held.finish(result);
  return result;
}

export function safeParam(ctx: Ctx, name: string): string {
  const value = ctx.param(name);
  if (value === '' || value.length > 300 || value.includes('\0')) throw new ApiError('not_found');
  return value;
}
