import type { Context } from './core';

export type Handler = (ctx: Context) => Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter((segment) => segment !== ''), handler });
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

  patch(pattern: string, handler: Handler): void {
    this.add('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, handler);
  }

  match(ctx: Context): Handler | null {
    const parts = ctx.path.split('/').filter((segment) => segment !== '');
    for (const candidate of this.routes) {
      if (candidate.method !== ctx.method && !(candidate.method === 'GET' && ctx.method === 'HEAD')) continue;
      const params = matchSegments(candidate.segments, parts);
      if (params === null) continue;
      ctx.params = params;
      return candidate.handler;
    }
    return null;
  }
}

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index];
    if (segment === '*') {
      params.rest = parts.slice(index).join('/');
      return params.rest === '' ? null : params;
    }
    if (index >= parts.length) return null;
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = parts[index];
      continue;
    }
    if (segment !== parts[index]) return null;
  }
  return pattern.length === parts.length ? params : null;
}
