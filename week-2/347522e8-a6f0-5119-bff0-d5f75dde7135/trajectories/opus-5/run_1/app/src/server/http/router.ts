/** Route declarations and path matching. */

import type { Principal } from './auth.js';
import type { JsonObject, MultipartBody } from './body.js';
import type { Role } from '../../shared/types.js';
import type { ResolvedEntities, ResolverName } from './resolve.js';

export type RouteResult =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'empty'; status: number }
  | { kind: 'redirect'; location: string };

export const json = (status: number, body: unknown): RouteResult => ({ kind: 'json', status, body });
export const empty = (status: number): RouteResult => ({ kind: 'empty', status });
export const redirect = (location: string): RouteResult => ({ kind: 'redirect', location });

interface BaseContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: JsonObject;
  multipart: MultipartBody;
  sessionId: string | null;
  headers: Record<string, string | undefined>;
  resolved: ResolvedEntities;
  setCookie(value: string): void;
}

/** A route open to visitors, which therefore has no principal. */
export type PublicContext = BaseContext;

/** A route behind the session cookie, which always has a principal. */
export interface SessionContext extends BaseContext {
  principal: Principal;
}

interface RouteBase {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: 'json' | 'multipart';
  resolve?: ResolverName[];
}

export type Route =
  | (RouteBase & {
      auth: 'none';
      roles?: undefined;
      handle(context: PublicContext): Promise<RouteResult>;
    })
  | (RouteBase & {
      auth: 'session';
      roles?: Role[];
      handle(context: SessionContext): Promise<RouteResult>;
    });

interface CompiledRoute {
  route: Route;
  segments: string[];
}

export class Router {
  private readonly compiled: CompiledRoute[] = [];

  add(route: Route): void {
    this.compiled.push({ route, segments: route.path.split('/').filter((s) => s.length > 0) });
  }

  addAll(routes: readonly Route[]): void {
    for (const route of routes) this.add(route);
  }

  /** The route for this method and path, plus its path parameters. */
  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split('/').filter((s) => s.length > 0);
    for (const { route, segments } of this.compiled) {
      if (route.method !== method || segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const part = parts[index];
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
}
