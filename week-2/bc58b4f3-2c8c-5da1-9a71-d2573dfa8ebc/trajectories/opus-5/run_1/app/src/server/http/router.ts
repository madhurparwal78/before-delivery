import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionRecord } from '../auth/sessions.js';

export type BodyKind = 'json' | 'multipart' | 'none';

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  rawBody: Buffer;
  session: SessionRecord | null;
  headers: IncomingMessage['headers'];
}

export interface AuthenticatedContext extends RequestContext {
  session: SessionRecord;
}

export interface Route {
  method: string;
  pattern: string;
  body: BodyKind;
  auth: true;
  handler: (ctx: AuthenticatedContext) => Promise<Reply>;
}

export interface PublicRoute {
  method: string;
  pattern: string;
  body: BodyKind;
  auth: false;
  handler: (ctx: RequestContext) => Promise<Reply>;
}

export type AnyRoute = Route | PublicRoute;

interface MatchedRoute {
  route: AnyRoute;
  params: Record<string, string>;
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, patternPart] of patternParts.entries()) {
    const pathPart = pathParts[index] ?? '';
    if (patternPart.startsWith(':')) {
      if (pathPart === '') {
        return null;
      }
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

export function matchRoute(routes: readonly AnyRoute[], method: string, path: string): MatchedRoute | null {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const params = matchPattern(route.pattern, path);
    if (params !== null) {
      return { route, params };
    }
  }
  return null;
}
