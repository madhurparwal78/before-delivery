import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Actor } from '../auth';

export interface HandlerResult {
  status: number;
  json?: unknown;
  body?: Buffer;
  contentType?: string;
  headers?: [string, string][];
}

export interface BaseContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  searchParams: URLSearchParams;
  body: Record<string, unknown>;
  now: Date;
  sessionToken: string | null;
  idempotencyKey: string | null;
  routeKey: string;
}

export interface RequestContext extends BaseContext {
  actor: Actor;
}

export type Route =
  | {
      audience: 'public';
      method: string;
      segments: string[];
      handler: (ctx: BaseContext) => Promise<HandlerResult>;
    }
  | {
      audience: 'member' | 'operator';
      method: string;
      segments: string[];
      handler: (ctx: RequestContext) => Promise<HandlerResult>;
    };

function segmentsOf(pattern: string): string[] {
  return pattern.split('/').filter((part) => part.length > 0);
}

export function publicRoute(
  method: string,
  pattern: string,
  handler: (ctx: BaseContext) => Promise<HandlerResult>,
): Route {
  return { audience: 'public', method, segments: segmentsOf(pattern), handler };
}

export function memberRoute(
  method: string,
  pattern: string,
  handler: (ctx: RequestContext) => Promise<HandlerResult>,
): Route {
  return { audience: 'member', method, segments: segmentsOf(pattern), handler };
}

export function operatorRoute(
  method: string,
  pattern: string,
  handler: (ctx: RequestContext) => Promise<HandlerResult>,
): Route {
  return { audience: 'operator', method, segments: segmentsOf(pattern), handler };
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(routes: Route[], method: string, path: string): RouteMatch | null {
  const segments = path.split('/').filter((part) => part.length > 0);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const expected = candidate.segments[index] as string;
      const actual = segments[index] as string;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

export function routeKeyOf(route: Route): string {
  return `${route.method} /${route.segments.join('/')}`;
}

export function json(status: number, value: unknown, headers?: [string, string][]): HandlerResult {
  return headers ? { status, json: value, headers } : { status, json: value };
}

export function noContent(headers?: [string, string][]): HandlerResult {
  return headers ? { status: 204, headers } : { status: 204 };
}

export function pdfResult(body: Buffer): HandlerResult {
  return { status: 200, body, contentType: 'application/pdf' };
}
