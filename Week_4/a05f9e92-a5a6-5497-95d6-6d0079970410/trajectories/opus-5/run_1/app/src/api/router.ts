/**
 * The route table. Paths are matched by segment patterns, with `:name` capturing
 * one segment. Every endpoint lives under /api.
 */

import type { RequestContext } from '../http/context';

export interface RouteResult {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** Raw bytes, for attachment and export downloads. */
  readonly bytes?: Buffer;
  readonly contentType?: string;
}

export type Params = Readonly<Record<string, string>>;

export type Handler = (context: RequestContext, params: Params) => Promise<RouteResult>;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler): void {
  routes.push({
    method,
    segments: pattern.split('/').filter((s) => s.length > 0),
    handler,
  });
}

export const ok = (body: unknown): RouteResult => ({ status: 200, body });
export const created = (body: unknown): RouteResult => ({ status: 201, body });
export const accepted = (body: unknown): RouteResult => ({ status: 202, body });
export const noContent = (): RouteResult => ({ status: 204 });

export interface Matched {
  readonly handler: Handler;
  readonly params: Params;
}

export function match(method: string, path: string): Matched | null {
  const parts = path.split('/').filter((s) => s.length > 0);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let fits = true;
    for (let i = 0; i < parts.length; i += 1) {
      const segment = candidate.segments[i];
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(parts[i]);
        continue;
      }
      if (segment !== parts[i]) {
        fits = false;
        break;
      }
    }
    if (fits) return { handler: candidate.handler, params };
  }
  return null;
}

/** True when any route exists for the path under another method. */
export function pathKnown(path: string): boolean {
  const parts = path.split('/').filter((s) => s.length > 0);
  return routes.some((candidate) => {
    if (candidate.segments.length !== parts.length) return false;
    return candidate.segments.every((segment, i) => segment.startsWith(':') || segment === parts[i]);
  });
}

export function routeCount(): number {
  return routes.length;
}
