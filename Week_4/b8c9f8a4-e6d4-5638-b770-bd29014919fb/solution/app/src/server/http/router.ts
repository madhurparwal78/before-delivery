import type { Context } from './request.js';

type Handler = (context: Context) => Promise<void> | void;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: Handler): this {
    return this.add('PUT', pattern, handler);
  }

  patch(pattern: string, handler: Handler): this {
    return this.add('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: Handler): this {
    return this.add('DELETE', pattern, handler);
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = path.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let fits = true;
      for (let index = 0; index < route.parts.length; index += 1) {
        const expected = route.parts[index];
        const found = parts[index];
        if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(found);
        else if (expected !== found) {
          fits = false;
          break;
        }
      }
      if (fits) return { handler: route.handler, params };
    }
    return null;
  }
}
