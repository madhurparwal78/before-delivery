import type { ApiResponse, BodyKind, RequestContext } from './context.js';

export type Handler = (ctx: RequestContext) => Promise<ApiResponse>;

export interface Route {
  method: string;
  segments: readonly string[];
  bodyKind: BodyKind;
  public: boolean;
  handler: Handler;
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

export interface MatchResult {
  match: RouteMatch | null;
  pathKnown: boolean;
}

const routes: Route[] = [];

export function route(
  method: string,
  pattern: string,
  options: { bodyKind?: BodyKind; public?: boolean },
  handler: Handler,
): void {
  routes.push({
    method,
    segments: pattern.split('/').filter((segment) => segment.length > 0),
    bodyKind: options.bodyKind ?? 'none',
    public: options.public ?? false,
    handler,
  });
}

function matchSegments(
  pattern: readonly string[],
  actual: readonly string[],
): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index]!;
    const value = actual[index]!;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(value);
    } else if (expected !== value) {
      return null;
    }
  }
  return params;
}

export function findRoute(method: string, path: string): MatchResult {
  const actual = path.split('/').filter((segment) => segment.length > 0);
  let pathKnown = false;
  for (const candidate of routes) {
    const params = matchSegments(candidate.segments, actual);
    if (!params) continue;
    pathKnown = true;
    if (candidate.method === method) return { match: { route: candidate, params }, pathKnown: true };
  }
  return { match: null, pathKnown };
}
