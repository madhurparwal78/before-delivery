import type { Role } from '../../shared/api.js';
import type {
  HandlerResult,
  PublicContext,
  SessionContext,
  SessionResolveContext,
} from './context.js';

export type BodyKind = 'none' | 'json' | 'multipart';

interface RouteShape {
  readonly method: string;
  readonly pattern: readonly string[];
  readonly body: BodyKind;
}

export interface PublicRoute extends RouteShape {
  readonly auth: 'anyone';
  readonly handle: (context: PublicContext) => Promise<HandlerResult>;
}

export interface SessionRoute extends RouteShape {
  readonly auth: 'session';
  readonly keyed: boolean;
  readonly roles: readonly Role[] | null;
  readonly resolve: ((context: SessionResolveContext) => Promise<unknown>) | null;
  readonly handle: (context: SessionContext, resolved: unknown) => Promise<HandlerResult>;
}

export type Route = PublicRoute | SessionRoute;

function segments(pattern: string): string[] {
  return pattern.split('/').filter((part) => part !== '');
}

export function publicRoute(
  method: string,
  pattern: string,
  body: BodyKind,
  handle: (context: PublicContext) => Promise<HandlerResult>,
): PublicRoute {
  return { auth: 'anyone', method, pattern: segments(pattern), body, handle };
}

export interface SessionRouteSpec<R> {
  readonly method: string;
  readonly pattern: string;
  readonly body?: BodyKind;
  readonly keyed?: boolean;
  readonly roles?: readonly Role[];
  readonly resolve?: (context: SessionResolveContext) => Promise<R>;
  readonly handle: (context: SessionContext, resolved: R) => Promise<HandlerResult>;
}

/** The one place a route's resolved value is erased, so the pipeline can stay generic. */
export function sessionRoute<R>(spec: SessionRouteSpec<R>): SessionRoute {
  return {
    auth: 'session',
    method: spec.method,
    pattern: segments(spec.pattern),
    body: spec.body ?? 'none',
    keyed: spec.keyed ?? false,
    roles: spec.roles ?? null,
    resolve: (spec.resolve ?? null) as ((context: SessionResolveContext) => Promise<unknown>) | null,
    handle: spec.handle as (context: SessionContext, resolved: unknown) => Promise<HandlerResult>,
  };
}

export interface RouteMatch {
  readonly route: Route;
  readonly params: Record<string, string>;
}

export function matchRoute(routes: readonly Route[], method: string, path: string): RouteMatch | null {
  const parts = segments(path);
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < route.pattern.length; index += 1) {
      const expected = route.pattern[index] as string;
      const actual = parts[index] as string;
      if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
      else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}
