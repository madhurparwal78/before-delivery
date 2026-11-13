import { Ctx } from './context';

export type RouteKind = 'api' | 'upload' | 'stream' | 'page' | 'raw';

export type Handler = (ctx: Ctx) => Promise<void>;

export type Route = {
  method: string;
  segments: string[];
  kind: RouteKind;
  handler: Handler;
};

const routes: Route[] = [];

function split(pattern: string): string[] {
  return pattern.split('/').filter((part) => part.length > 0);
}

export function route(method: string, pattern: string, kind: RouteKind, handler: Handler): void {
  routes.push({ method, segments: split(pattern), kind, handler });
}

export type Match = { route: Route; params: Record<string, string> };

function matchSegments(
  routeSegments: string[],
  pathSegments: string[]
): Record<string, string> | null {
  const params: Record<string, string> = {};
  const wildcardIndex = routeSegments.findIndex((segment) => segment === '*');
  if (wildcardIndex === -1) {
    if (routeSegments.length !== pathSegments.length) return null;
  } else if (pathSegments.length < wildcardIndex) {
    return null;
  }
  for (let i = 0; i < routeSegments.length; i += 1) {
    const segment = routeSegments[i];
    if (segment === '*') {
      params.rest = pathSegments.slice(i).join('/');
      return params;
    }
    const value = pathSegments[i];
    if (value === undefined) return null;
    if (segment.startsWith(':')) params[segment.slice(1)] = value;
    else if (segment !== value) return null;
  }
  return params;
}

export function findRoute(method: string, pathname: string): { match: Match | null; pathKnown: boolean } {
  const pathSegments = split(pathname).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  let pathKnown = false;
  for (const candidate of routes) {
    const params = matchSegments(candidate.segments, pathSegments);
    if (params === null) continue;
    pathKnown = true;
    if (candidate.method === method || (method === 'HEAD' && candidate.method === 'GET')) {
      return { match: { route: candidate, params }, pathKnown: true };
    }
  }
  return { match: null, pathKnown };
}
