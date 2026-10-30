import type { Reply, RequestContext } from './context.js';
import type { Role } from '../domain/courseLifecycle.js';

export type AuthMode = 'required' | 'public' | 'token_or_session';

export interface Route {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly auth: AuthMode;
  readonly roles?: readonly Role[];
  readonly handler: (ctx: RequestContext) => Promise<Reply>;
}

export type MatchResult =
  | { readonly kind: 'match'; readonly route: Route; readonly params: Record<string, string> }
  | { readonly kind: 'method_not_allowed' }
  | { readonly kind: 'no_route' };

function segments(path: string): string[] {
  return path.split('/').filter((part) => part !== '');
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = segments(pattern);
  const pathParts = segments(path);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, patternPart] of patternParts.entries()) {
    const pathPart = pathParts[index];
    if (pathPart === undefined) return null;
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) return null;
  }
  return params;
}

export function matchRoute(routes: readonly Route[], method: string, path: string): MatchResult {
  let pathMatched = false;
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params === null) continue;
    pathMatched = true;
    if (route.method === method) return { kind: 'match', route, params };
  }
  if (method === 'HEAD') {
    for (const route of routes) {
      const params = matchPath(route.path, path);
      if (params !== null && route.method === 'GET') return { kind: 'match', route, params };
    }
  }
  return pathMatched ? { kind: 'method_not_allowed' } : { kind: 'no_route' };
}
