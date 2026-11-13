import type { RouteContext, RouteResult } from './context.js';

export type RouteHandler = (ctx: RouteContext) => Promise<RouteResult>;

export interface Route {
  method: string;
  segments: readonly string[];
  handler: RouteHandler;
}

export function route(method: string, path: string, handler: RouteHandler): Route {
  return { method, segments: path.split('/').filter((part) => part !== ''), handler };
}

export interface Match {
  handler: RouteHandler;
  params: Record<string, string>;
}

export function matchRoute(routes: readonly Route[], method: string, pathname: string): Match | 'method' | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  let pathMatched = false;
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let index = 0; index < parts.length; index += 1) {
      const expected = candidate.segments[index] as string;
      const actual = parts[index] as string;
      if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
      else if (expected !== actual) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (candidate.method === method) return { handler: candidate.handler, params };
  }
  return pathMatched ? 'method' : null;
}
