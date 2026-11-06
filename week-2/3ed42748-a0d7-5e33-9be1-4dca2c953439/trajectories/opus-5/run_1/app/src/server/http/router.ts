import type { BodyKind } from './boundary.js';

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
  setCookie?: string;
}

export type Auth = 'anyone' | 'session' | 'courier' | 'staff' | 'founder';

export interface Route<Handler> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  pattern: string;
  auth: Auth;
  bodyKind: BodyKind;
  bodyLimit?: number;
  /** Set on endpoints open to anyone that still behave differently with a session. */
  withActor?: boolean;
  handler: Handler;
}

interface CompiledRoute<Handler> extends Route<Handler> {
  segments: string[];
}

function compile<Handler>(route: Route<Handler>): CompiledRoute<Handler> {
  return { ...route, segments: route.pattern.split('/').slice(1) };
}

function matchPath(segments: string[], path: string): Record<string, string> | null {
  const parts = path.split('/').slice(1);
  const params: Record<string, string> = {};
  for (let index = 0; index < segments.length; index += 1) {
    const expected = segments[index]!;
    if (expected === '*') {
      return params;
    }
    const actual = parts[index];
    if (actual === undefined) return null;
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return parts.length === segments.length ? params : null;
}

export interface Resolution<Handler> {
  route: Route<Handler>;
  params: Record<string, string>;
}

export class Router<Handler> {
  private readonly routes: CompiledRoute<Handler>[] = [];

  add(route: Route<Handler>): void {
    this.routes.push(compile(route));
  }

  /** Resolves a path and method, telling a missing path apart from a wrong method. */
  resolve(method: string, path: string): Resolution<Handler> | 'method_not_allowed' | 'not_found' {
    const wanted = method === 'HEAD' ? 'GET' : method;
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchPath(route.segments, path);
      if (params === null) continue;
      pathMatched = true;
      if (route.method === wanted) return { route, params };
    }
    return pathMatched ? 'method_not_allowed' : 'not_found';
  }
}
