import type { IncomingMessage } from 'node:http';
import type { Db } from '../db';
import type { Role } from '../../shared/types';
import type { MultipartBody } from './body';
import type { AuthUser } from './session';

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
  cookie?: string;
}

export interface Ctx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  request: IncomingMessage;
  body: Record<string, unknown>;
  multipart: MultipartBody | null;
  user: AuthUser | null;
  idempotencyKey: string | null;
  unaccepted: Record<string, string>;
  store: Map<string, unknown>;
}

export interface Route {
  method: string;
  pattern: string;
  roles: ReadonlyArray<Role> | 'open';
  bodyFields?: ReadonlyArray<string>;
  multipartFields?: ReadonlyArray<string>;
  requiresKey?: boolean;
  originSensitive?: boolean;
  countsClaim?: boolean;
  resolve?: (ctx: Ctx, client: Db) => Promise<void>;
  reauth?: (ctx: Ctx) => boolean;
  idempotencyBody?: (ctx: Ctx) => unknown;
  handler: (ctx: Ctx) => Promise<Reply>;
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(
  routes: ReadonlyArray<Route>,
  method: string,
  path: string,
): RouteMatch | null {
  const segments = path.split('/').filter((segment) => segment !== '');
  for (const route of routes) {
    if (route.method !== method) continue;
    const patternSegments = route.pattern.split('/').filter((segment) => segment !== '');
    if (patternSegments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, patternSegment] of patternSegments.entries()) {
      const segment = segments[index] ?? '';
      if (patternSegment.startsWith(':')) {
        params[patternSegment.slice(1)] = decodeURIComponent(segment);
      } else if (patternSegment !== segment) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}
