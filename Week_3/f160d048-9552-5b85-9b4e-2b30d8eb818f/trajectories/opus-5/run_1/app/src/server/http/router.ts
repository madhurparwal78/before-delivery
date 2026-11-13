import type { Context } from './context';

export type Handler = (ctx: Context) => Promise<unknown> | unknown;

/** A route answer that is not plain JSON, written by the handler itself. */
export const HANDLED = Symbol('handled');

export type BodyKind = 'none' | 'json' | 'multipart' | 'raw';

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  status: number;
  body: BodyKind;
}

export interface MatchedRoute {
  handler: Handler;
  params: Record<string, string>;
  status: number;
  body: BodyKind;
}

export class Router {
  private readonly routes: Route[] = [];

  private add(method: string, pattern: string, handler: Handler, status: number, body: BodyKind): void {
    this.routes.push({ method, segments: pattern.split('/').filter((part) => part.length > 0), handler, status, body });
  }

  get(pattern: string, handler: Handler): void {
    this.add('GET', pattern, handler, 200, 'none');
  }

  post(pattern: string, handler: Handler, body: BodyKind = 'json'): void {
    this.add('POST', pattern, handler, 200, body);
  }

  put(pattern: string, handler: Handler, body: BodyKind = 'json'): void {
    this.add('PUT', pattern, handler, 200, body);
  }

  patch(pattern: string, handler: Handler): void {
    this.add('PATCH', pattern, handler, 200, 'json');
  }

  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, handler, 200, 'none');
  }

  match(method: string, pathname: string): MatchedRoute | null {
    const parts = pathname.split('/').filter((part) => part.length > 0);
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (const [index, segment] of route.segments.entries()) {
        const value = parts[index] as string;
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
        else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params, status: route.status, body: route.body };
    }
    return null;
  }
}
