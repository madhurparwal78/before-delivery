import type { RequestContext } from './context';

export type RouteHandler = (ctx: RequestContext) => Promise<void>;

export interface Route {
  method: string;
  pattern: string;
  handler: RouteHandler;
  /** Routes that run without a session. */
  anonymous?: boolean;
  /** The one endpoint that also accepts multipart/form-data. */
  acceptsMultipart?: boolean;
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

const segmentsOf = (pattern: string): string[] => pattern.split('/').filter((part) => part.length > 0);

export function matchRoute(routes: readonly Route[], method: string, path: string): RouteMatch | null {
  const pathParts = segmentsOf(path);
  for (const route of routes) {
    if (route.method !== method) continue;
    const patternParts = segmentsOf(route.pattern);
    if (patternParts.length !== pathParts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < patternParts.length; index += 1) {
      const expected = patternParts[index] as string;
      const actual = pathParts[index] as string;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}
