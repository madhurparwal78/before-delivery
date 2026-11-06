/**
 * The request pipeline. The order of the checks below *is* the single error
 * precedence order from the brief, so no endpoint can disagree about it.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.js';
import * as errors from './errors.js';
import {
  JSON_BODY_LIMIT,
  MULTIPART_BODY_LIMIT,
  parseJsonObject,
  parseMultipart,
  readBody,
  type JsonObject,
  type MultipartBody,
} from './body.js';
import { parseCookies, principalForSession, SESSION_COOKIE, type Principal } from './auth.js';
import { resolveAll } from './resolve.js';
import type { Router, RouteResult } from './router.js';

const EMPTY_MULTIPART: MultipartBody = { fields: {}, files: {} };
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function ownOrigin(request: IncomingMessage): string | null {
  const host = headerValue(request, 'host');
  return host === undefined ? null : `http://${host}`;
}

function send(response: ServerResponse, result: RouteResult, cookies: string[]): void {
  const headers: Record<string, string | string[]> = {};
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  switch (result.kind) {
    case 'json': {
      const payload = Buffer.from(JSON.stringify(result.body ?? null), 'utf8');
      headers['content-type'] = 'application/json; charset=utf-8';
      headers['content-length'] = String(payload.length);
      headers['cache-control'] = 'no-store';
      response.writeHead(result.status, headers);
      response.end(payload);
      return;
    }
    case 'empty':
      response.writeHead(result.status, headers);
      response.end();
      return;
    case 'redirect':
      headers['location'] = result.location;
      headers['cache-control'] = 'no-store';
      response.writeHead(302, headers);
      response.end();
      return;
  }
}

export function sendApiError(
  response: ServerResponse,
  error: ApiError,
  cookies: string[] = [],
): void {
  send(response, { kind: 'json', status: error.status, body: error.body }, cookies);
}

export async function handleApiRequest(
  router: Router,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const cookies: string[] = [];
  const setCookie = (value: string): void => {
    cookies.push(value);
  };

  try {
    const method = request.method ?? 'GET';
    const contentType = headerValue(request, 'content-type') ?? '';
    const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data');
    const matched = router.match(method, url.pathname);

    // 1. Body limits.
    let raw: Buffer = Buffer.alloc(0);
    if (STATE_CHANGING.has(method)) {
      raw = await readBody(request, isMultipart ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT);
    } else {
      request.resume();
    }

    // 2. Same-origin writes only.
    const origin = headerValue(request, 'origin');
    if (STATE_CHANGING.has(method) && origin !== undefined && origin !== ownOrigin(request)) {
      throw errors.crossOrigin();
    }

    // 3. Share paths can only be read.
    if (url.pathname.startsWith('/api/share/') && method !== 'GET') {
      throw errors.readOnly();
    }

    if (!matched) throw errors.notFound();
    const { route, params } = matched;

    // 4. Media type.
    let body: JsonObject = {};
    let multipart: MultipartBody = EMPTY_MULTIPART;
    if (route.body === 'json') {
      if (contentType !== '' && !contentType.toLowerCase().startsWith('application/json')) {
        throw errors.unsupportedMediaType();
      }
      body = parseJsonObject(raw);
    } else if (route.body === 'multipart') {
      if (!isMultipart) throw errors.unsupportedMediaType();
      multipart = parseMultipart(raw, contentType);
    }

    // 5. Authentication.
    const sessionId = parseCookies(headerValue(request, 'cookie'))[SESSION_COOKIE] ?? null;
    const principal: Principal | null =
      sessionId === null ? null : await principalForSession(sessionId);

    // 6. Path identifiers, including another renter's records.
    // 7. Role.
    // 8 onwards are the endpoint's own checks, in the order the brief states.
    const base = {
      method,
      path: url.pathname,
      params,
      query: url.searchParams,
      body,
      multipart,
      sessionId,
      headers: {
        'idempotency-key': headerValue(request, 'idempotency-key'),
      },
      setCookie,
    };

    if (route.auth === 'none') {
      const resolved = await resolveAll(route.resolve ?? [], params, principal);
      send(response, await route.handle({ ...base, resolved }), cookies);
      return;
    }
    if (principal === null) throw errors.unauthenticated();
    const resolved = await resolveAll(route.resolve ?? [], params, principal);
    if (route.roles !== undefined && !route.roles.includes(principal.role)) {
      throw errors.forbidden();
    }
    send(response, await route.handle({ ...base, resolved, principal }), cookies);
  } catch (error) {
    if (error instanceof ApiError) {
      sendApiError(response, error, cookies);
      return;
    }
    process.stderr.write(`unhandled request failure: ${String(error)}\n`);
    if (error instanceof Error && error.stack !== undefined) {
      process.stderr.write(`${error.stack}\n`);
    }
    send(response, { kind: 'json', status: 500, body: { error: 'internal' } }, cookies);
  }
}
