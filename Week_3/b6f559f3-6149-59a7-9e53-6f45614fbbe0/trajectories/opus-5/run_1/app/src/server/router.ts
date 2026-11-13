import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Person } from './access';

export interface Context {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  params: Record<string, string>;
  person: Person | null;
  sessionId: string | null;
}

export type Handler = (context: Context) => Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    this.routes.push({
      method,
      segments: path.split('/').filter((segment) => segment.length > 0),
      handler,
    });
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((segment) => segment.length > 0);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i];
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(parts[i]);
          continue;
        }
        if (segment !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  hasPath(pathname: string): boolean {
    const parts = pathname.split('/').filter((segment) => segment.length > 0);
    return this.routes.some((route) => {
      if (route.segments.length !== parts.length) return false;
      return route.segments.every(
        (segment, index) => segment.startsWith(':') || segment === parts[index],
      );
    });
  }
}
