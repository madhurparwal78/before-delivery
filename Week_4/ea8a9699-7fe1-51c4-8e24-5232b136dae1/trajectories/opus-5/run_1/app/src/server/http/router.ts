import type { BodyKind, HttpResponse, RequestContext } from './context.js';

export type Handler = (context: RequestContext) => Promise<HttpResponse>;

export interface Route {
  method: string;
  segments: string[];
  bodyKind: BodyKind;
  handler: Handler;
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, bodyKind: BodyKind, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter((part) => part !== ''), bodyKind, handler });
  }

  get(pattern: string, handler: Handler): void {
    this.add('GET', pattern, 'none', handler);
  }

  post(pattern: string, bodyKind: BodyKind, handler: Handler): void {
    this.add('POST', pattern, bodyKind, handler);
  }

  patch(pattern: string, handler: Handler): void {
    this.add('PATCH', pattern, 'json', handler);
  }

  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, 'none', handler);
  }

  match(method: string, path: string): RouteMatch | null {
    const parts = path.split('/').filter((part) => part !== '');
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index];
        const value = parts[index];
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return { route, params };
      }
    }
    return null;
  }

}
