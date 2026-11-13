import type { Ctx, Handler } from './http.js';

type Route = { method: string; pattern: string[]; handler: Handler };

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, pattern: pattern.split('/').filter(Boolean), handler });
  }

  get(pattern: string, handler: Handler): void { this.add('GET', pattern, handler); }
  post(pattern: string, handler: Handler): void { this.add('POST', pattern, handler); }
  patch(pattern: string, handler: Handler): void { this.add('PATCH', pattern, handler); }
  put(pattern: string, handler: Handler): void { this.add('PUT', pattern, handler); }
  delete(pattern: string, handler: Handler): void { this.add('DELETE', pattern, handler); }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.pattern.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const pat = route.pattern[i];
        if (pat.startsWith('{') && pat.endsWith('}')) {
          params[pat.slice(1, -1)] = decodeURIComponent(parts[i]);
        } else if (pat !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}
