import type { RequestContext } from './context';

export type Handler = (context: RequestContext) => Promise<void> | void;

export interface Route {
  readonly method: string;
  readonly path: string;
  readonly handler: Handler;
  readonly bodyLimit?: number;
}

interface CompiledRoute extends Route {
  readonly segments: readonly string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(routes: readonly Route[]): void {
    for (const route of routes) {
      this.routes.push({ ...route, segments: route.path.split('/').filter(Boolean) });
    }
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index]!;
        const part = parts[index]!;
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(part);
        } else if (segment !== part) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  /** The body limit is chosen from the path alone, before the body is read. */
  limitFor(method: string, path: string, fallback: number): number {
    const matched = this.match(method, path);
    return matched?.route.bodyLimit ?? fallback;
  }
}
