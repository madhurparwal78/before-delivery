import type { Ctx } from './http';

export type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter((s) => s.length > 0), handler });
  }

  get(pattern: string, handler: Handler): void {
    this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): void {
    this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: Handler): void {
    this.add('PUT', pattern, handler);
  }

  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, handler);
  }

  /** Finds the handler for a path, and reports which methods the path allows. */
  match(
    method: string,
    pathname: string,
  ): { handler: Handler; params: Record<string, string> } | { allowed: string[] } {
    const parts = pathname
      .split('/')
      .filter((s) => s.length > 0)
      .map((s) => decodeURIComponent(s));
    const allowed = new Set<string>();
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (params === null) continue;
      allowed.add(route.method);
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) {
        return { handler: route.handler, params };
      }
    }
    return { allowed: [...allowed] };
  }
}

function matchSegments(
  segments: readonly string[],
  parts: readonly string[],
): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment.startsWith('*')) {
      const rest = parts.slice(i);
      if (rest.length === 0) return null;
      params[segment.slice(1)] = rest.join('/');
      return params;
    }
    if (i >= parts.length) return null;
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = parts[i];
      continue;
    }
    if (segment !== parts[i]) return null;
  }
  return parts.length === segments.length ? params : null;
}
