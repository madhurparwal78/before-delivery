import type { RequestContext } from './context.js';
import { methodNotAllowed } from './errors.js';

export type Handler = (context: RequestContext) => Promise<unknown> | unknown;

export type BodyKind = 'json' | 'csv' | 'calendar' | 'none';

export interface RouteDefinition {
  method: string;
  handler: Handler;
  bodyKind: BodyKind;
  segments: string[];
}

export interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string>;
}

export class Router {
  private readonly routes: RouteDefinition[] = [];

  add(method: string, pattern: string, bodyKind: BodyKind, handler: Handler): void {
    this.routes.push({ method, bodyKind, handler, segments: pattern.split('/').filter(Boolean) });
  }

  get(pattern: string, handler: Handler): void {
    this.add('GET', pattern, 'none', handler);
  }

  post(pattern: string, handler: Handler, bodyKind: BodyKind = 'json'): void {
    this.add('POST', pattern, bodyKind, handler);
  }

  patch(pattern: string, handler: Handler): void {
    this.add('PATCH', pattern, 'json', handler);
  }

  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, 'none', handler);
  }

  /**
   * Resolves a path to a route, or null when no route owns the path. A path owned by
   * another method raises method_not_allowed, which error precedence puts first.
   */
  resolve(method: string, path: string): RouteMatch | null {
    const segments = path.split('/').filter(Boolean);
    let pathExists = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments);
      if (!params) continue;
      pathExists = true;
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) {
        return { route, params };
      }
    }
    if (pathExists) throw methodNotAllowed();
    return null;
  }
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index]!;
    const value = actual[index]!;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(value);
      continue;
    }
    if (expected !== value) return null;
  }
  return params;
}
