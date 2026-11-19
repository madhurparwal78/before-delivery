import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Viewer } from './access.js';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  viewer: Viewer | null;
}

export type RouteHandler = (context: RouteContext) => Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    this.routes.push({ method, segments: pattern.split('/').filter((part) => part !== ''), handler });
  }

  match(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | null {
    const parts = path.split('/').filter((part) => part !== '');
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index] as string;
        const value = parts[index] as string;
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
        else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }
}
