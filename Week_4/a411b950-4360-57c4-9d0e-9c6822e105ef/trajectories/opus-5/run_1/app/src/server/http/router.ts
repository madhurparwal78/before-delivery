import type { IncomingMessage, ServerResponse } from 'node:http';
import { ownOrigin } from '../config.ts';
import { query } from '../db/pool.ts';
import { ApiError, unauthenticated } from '../errors.ts';
import {
  ENQUIRY_BODY_LIMIT,
  JSON_BODY_LIMIT,
  parseJsonBody,
  parseMultipartBody,
  readRawBody,
  STEM_BODY_LIMIT,
  type MultipartBody,
} from './body.ts';
import { sendError } from './respond.ts';

export type BodyKind = 'none' | 'json' | 'enquiry-multipart' | 'stem-multipart';

export type RequestContext = {
  request: IncomingMessage;
  response: ServerResponse;
  params: Record<string, string>;
  search: URLSearchParams;
  json: Record<string, unknown>;
  multipart: MultipartBody | null;
  now: Date;
  operatorEmail: string | null;
  clientIp: string;
};

export type Handler = (context: RequestContext) => Promise<void>;

export type Route = {
  path: string;
  method: string;
  handler: Handler;
  body?: BodyKind;
  requiresSession?: boolean;
};

type CompiledRoute = {
  segments: string[];
  method: string;
  handler: Handler;
  body: BodyKind;
  requiresSession: boolean;
};

const routes: CompiledRoute[] = [];
const readOnlyPathPrefixes = ['/api/listen/'];

export function registerRoutes(table: readonly Route[]): void {
  for (const route of table) {
    routes.push({
      segments: route.path.split('/').filter((segment) => segment !== ''),
      method: route.method,
      handler: route.handler,
      body: route.body ?? (route.method === 'GET' ? 'none' : 'json'),
      requiresSession: route.requiresSession ?? false,
    });
  }
}

function matchSegments(route: CompiledRoute, parts: readonly string[]): Record<string, string> | null {
  if (route.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 1) {
    const expected = route.segments[index] as string;
    const actual = parts[index] as string;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

const BODY_LIMITS: Record<BodyKind, number> = {
  none: JSON_BODY_LIMIT,
  json: JSON_BODY_LIMIT,
  'enquiry-multipart': ENQUIRY_BODY_LIMIT,
  'stem-multipart': STEM_BODY_LIMIT,
};

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function operatorFromCookie(request: IncomingMessage): Promise<string | null> {
  const cookieHeader = request.headers.cookie;
  if (cookieHeader === undefined) return null;
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('earshot_session='));
  if (pair === undefined) return null;
  const token = pair.slice('earshot_session='.length);
  if (token === '') return null;
  const result = await query<{ operator_email: string }>(
    `SELECT operator_email FROM console_sessions WHERE token = $1`,
    [token],
  );
  return result.rows[0]?.operator_email ?? null;
}

function clientIpOf(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}

export async function dispatchApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
  const parts = url.pathname.split('/').filter((segment) => segment !== '');
  const method = (request.method ?? 'GET').toUpperCase();

  let matchedPath = false;
  const allowed: string[] = [];
  let chosen: { route: CompiledRoute; params: Record<string, string> } | null = null;

  for (const route of routes) {
    const params = matchSegments(route, parts);
    if (params === null) continue;
    matchedPath = true;
    allowed.push(route.method);
    if (route.method === method) chosen = { route, params };
  }

  if (!matchedPath) return false;

  try {
    if (chosen === null) {
      if (method === 'HEAD' && allowed.includes('GET')) {
        const getRoute = routes.find((route) => route.method === 'GET' && matchSegments(route, parts) !== null);
        if (getRoute !== undefined) {
          chosen = { route: getRoute, params: matchSegments(getRoute, parts) as Record<string, string> };
        }
      }
      if (chosen === null) {
        const readOnly = readOnlyPathPrefixes.some((prefix) => url.pathname.startsWith(prefix));
        throw new ApiError(
          405,
          readOnly ? 'read_only' : 'method_not_allowed',
          readOnly ? 'This listening link is read-only.' : 'That method is not allowed on this path.',
          {},
          { allow: [...new Set(allowed)].sort().join(', ') },
        );
      }
    }

    const origin = request.headers.origin;
    if (STATE_CHANGING.has(method) && origin !== undefined && origin !== 'null' && origin !== ownOrigin) {
      throw new ApiError(403, 'cross_origin', 'That request came from another origin.');
    }

    const route = chosen.route;
    let json: Record<string, unknown> = {};
    let multipart: MultipartBody | null = null;
    if (route.body === 'json') {
      json = parseJsonBody(await readRawBody(request, BODY_LIMITS.json));
    } else if (route.body === 'enquiry-multipart' || route.body === 'stem-multipart') {
      multipart = await parseMultipartBody(request, BODY_LIMITS[route.body]);
    } else if (STATE_CHANGING.has(method)) {
      await readRawBody(request, BODY_LIMITS.none);
    }

    const operatorEmail = await operatorFromCookie(request);
    if (route.requiresSession && operatorEmail === null) throw unauthenticated();

    await route.handler({
      request,
      response,
      params: chosen.params,
      search: url.searchParams,
      json,
      multipart,
      now: new Date(),
      operatorEmail,
      clientIp: clientIpOf(request),
    });
  } catch (error) {
    if (!response.headersSent) sendError(response, error);
    if (!(error instanceof ApiError)) {
      process.stderr.write(`request failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
    }
  }
  return true;
}
