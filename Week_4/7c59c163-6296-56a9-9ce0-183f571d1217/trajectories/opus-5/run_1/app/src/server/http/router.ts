import type { IncomingMessage, ServerResponse } from 'node:http';
import { forbidden, notFound, unauthenticated } from './errors.js';
import { checkOrigin, readJsonBody } from './boundary.js';
import { authenticate, hasRole } from '../auth.js';
import { enforceRateLimit } from '../ratelimit.js';
import type { Actor } from '../auth.js';
import type { Role } from '../domain/types.js';

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: { contentType: string; payload: Buffer | string };
  redirect?: string;
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({
  status,
  body,
  ...(headers === undefined ? {} : { headers }),
});
export const noContent = (): Reply => ({ status: 204 });
export const redirect = (location: string): Reply => ({ status: 302, redirect: location });

export interface Context<R = undefined> {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  actor: Actor;
  viaApiKey: boolean;
  resource: R;
}

export interface PublicContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
}

interface BaseRoute {
  method: string;
  pattern: string;
  segments: string[];
}

export interface PublicRoute extends BaseRoute {
  access: 'public';
  handler: (context: PublicContext) => Promise<Reply>;
}

export interface MemberRoute<R> extends BaseRoute {
  access: 'member';
  apiKey: boolean;
  venue: boolean;
  rawBody: boolean;
  roles: readonly Role[] | null;
  resource: ((context: Omit<Context<undefined>, 'resource'>) => Promise<R | null>) | null;
  handler: (context: Context<R>) => Promise<Reply>;
}

export type Route = PublicRoute | MemberRoute<unknown>;

const split = (pattern: string): string[] => pattern.split('/').filter((part) => part.length > 0);

export function publicRoute(
  method: string,
  pattern: string,
  handler: (context: PublicContext) => Promise<Reply>,
): Route {
  return { access: 'public', method, pattern, segments: split(pattern), handler };
}

export interface MemberOptions<R> {
  apiKey?: boolean;
  venue?: boolean;
  /** The handler reads the request stream itself, as the document upload does. */
  rawBody?: boolean;
  roles?: readonly Role[];
  resource?: (context: Omit<Context<undefined>, 'resource'>) => Promise<R | null>;
}

export function memberRoute<R = undefined>(
  method: string,
  pattern: string,
  options: MemberOptions<R>,
  handler: (context: Context<R>) => Promise<Reply>,
): Route {
  return {
    access: 'member',
    method,
    pattern,
    segments: split(pattern),
    apiKey: options.apiKey ?? false,
    venue: options.venue ?? false,
    rawBody: options.rawBody ?? false,
    roles: options.roles ?? null,
    resource: options.resource ?? null,
    handler: handler as (context: Context<unknown>) => Promise<Reply>,
  } as Route;
}

function matchPath(route: Route, segments: string[]): Record<string, string> | null {
  if (route.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < route.segments.length; index += 1) {
    const expected = route.segments[index] as string;
    const actual = segments[index] as string;
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

export interface Match {
  route: Route;
  params: Record<string, string>;
}

export function findRoute(routes: readonly Route[], method: string, pathname: string): Match | 'no_method' | null {
  const segments = split(pathname);
  let pathMatched = false;
  for (const route of routes) {
    const params = matchPath(route, segments);
    if (params === null) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return pathMatched ? 'no_method' : null;
}

const BODYLESS = new Set(['GET', 'HEAD']);

/** Runs one matched route under the published error precedence. */
export async function runRoute(
  match: Match,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<Reply> {
  checkOrigin(request);
  const consumesBody =
    !BODYLESS.has(request.method ?? 'GET') &&
    !(match.route.access === 'member' && match.route.rawBody);
  const body = consumesBody ? ((await readJsonBody(request)) as Record<string, unknown>) : {};

  if (match.route.access === 'public') {
    return match.route.handler({ request, response, url, params: match.params, body });
  }

  const route = match.route;
  const authentication = await authenticate(request);
  if (authentication.actor === null) throw unauthenticated();
  if (authentication.viaApiKey && !route.apiKey) throw forbidden();
  if (authentication.viaApiKey) await enforceRateLimit(authentication.actor);

  const base = {
    request,
    response,
    url,
    params: match.params,
    body,
    actor: authentication.actor,
    viaApiKey: authentication.viaApiKey,
  };

  let resource: unknown;
  if (route.resource !== null) {
    resource = await route.resource(base);
    if (resource === null) throw notFound();
  }
  if (route.venue && authentication.actor.venue === null) throw forbidden();
  if (route.roles !== null && !hasRole(authentication.actor, route.roles)) throw forbidden();
  return route.handler({ ...base, resource });
}

