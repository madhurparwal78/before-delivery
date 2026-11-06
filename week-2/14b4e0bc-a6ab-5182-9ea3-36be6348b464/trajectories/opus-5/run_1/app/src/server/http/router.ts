import type { Ctx, Reply } from './context.ts';

/** A handler returns a reply, or null when it has written the response itself. */
export type Handler = (ctx: Ctx) => Promise<Reply | null>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter((part) => part !== ''), handler });
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = path
      .split('/')
      .filter((part) => part !== '')
      .map((part) => decodeURIComponent(part));
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index];
        if (segment.startsWith(':')) params[segment.slice(1)] = parts[index];
        else if (segment !== parts[index]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  /** True when some route exists on this path under another method. */
  hasPath(path: string): boolean {
    const parts = path.split('/').filter((part) => part !== '');
    return this.routes.some(
      (route) =>
        route.segments.length === parts.length &&
        route.segments.every((segment, index) => segment.startsWith(':') || segment === parts[index]),
    );
  }
}
