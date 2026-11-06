import type { Ctx } from './context.ts';

export type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  segments: string[];
  methods: Map<string, Handler>;
}

export interface Match {
  handler: Handler | null;
  allow: string[];
  params: Record<string, string>;
}

export class Router {
  private readonly routes: Route[] = [];

  add(pattern: string, methods: Record<string, Handler>): this {
    const map = new Map<string, Handler>();
    for (const [method, handler] of Object.entries(methods)) {
      map.set(method.toUpperCase(), handler);
    }
    this.routes.push({ segments: splitPath(pattern), methods: map });
    return this;
  }

  match(path: string, method: string): Match | null {
    const segments = splitPath(path);
    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments);
      if (params === null) continue;
      const allow = [...route.methods.keys()];
      if (allow.includes('GET') && !allow.includes('HEAD')) allow.push('HEAD');
      const wanted = method === 'HEAD' ? 'GET' : method;
      return { handler: route.methods.get(wanted) ?? null, allow, params };
    }
    return null;
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index] as string;
    const given = actual[index] as string;
    if (expected.startsWith(':')) {
      if (given === '') return null;
      params[expected.slice(1)] = decodeURIComponent(given);
      continue;
    }
    if (expected !== given) return null;
  }
  return params;
}
