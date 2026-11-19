import { Ctx, Reply } from './context.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Route {
  method: Method;
  path: string;
  /** The keys this endpoint's JSON body may carry. An empty list accepts none. */
  keys: readonly string[];
  upload?: boolean;
  anonymous?: boolean;
  handler: (ctx: Ctx) => Promise<Reply>;
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

export interface PathMatch {
  routes: Route[];
  params: Record<string, string>;
}

function matchPath(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter((part) => part !== '');
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(segments[index]);
      continue;
    }
    if (part !== segments[index]) return null;
  }
  return params;
}

export class Router {
  constructor(private readonly routes: readonly Route[]) {}

  /** Every route sharing the matched path, so a wrong method can answer 405. */
  matchByPath(pathname: string): PathMatch | null {
    const segments = pathname.split('/').filter((part) => part !== '');
    let params: Record<string, string> | null = null;
    const matched: Route[] = [];
    for (const route of this.routes) {
      const result = matchPath(route.path, segments);
      if (result === null) continue;
      params = result;
      matched.push(route);
    }
    if (params === null) return null;
    return { routes: matched, params };
  }
}
