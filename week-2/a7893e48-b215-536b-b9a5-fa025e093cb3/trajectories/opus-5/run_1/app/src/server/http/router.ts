import type { Ctx, Reply } from './context.js';

export interface Route {
  method: string;
  pattern: string;
  multipart?: boolean;
  handle: (ctx: Ctx) => Promise<Reply>;
}

export interface Match {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(routes: readonly Route[], method: string, pathname: string): Match | null {
  const segments = pathname.split('/').filter((part) => part !== '');
  for (const route of routes) {
    if (route.method !== method) continue;
    const patternSegments = route.pattern.split('/').filter((part) => part !== '');
    if (patternSegments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < patternSegments.length; index += 1) {
      const expected = patternSegments[index] as string;
      const actual = segments[index] as string;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}
