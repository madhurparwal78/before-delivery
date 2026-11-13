/**
 * Routing and the published error precedence:
 *
 *   429 → 405/413/415 → 403 → 401 → replay → 404 → 410/423 → 409 → 422 → 502/503/504
 *
 * When Postgres cannot be reached, the only checks that run are the ones that need no
 * records: 405, 413, 415, 403 and 401 for a request carrying no session cookie. Every other
 * request answers 503.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { ApiError, apiError, type Audience } from './errors';
import { BillingUnavailable, CarrierFailure, MailUnavailable, StorageUnavailable } from '../services/outages';
import { DatabaseUnavailable } from '../db/pool';
import { isLanguage, type Language } from '../shared/format';
import { liveSession, type SignedInOperator } from '../db/shared-state';
import { now } from '../domain/time';
import {
  callerAddress,
  readBody,
  readCookies,
  readMultipart,
  parseJsonBody,
  refuseOtherOrigins,
  requireJson,
  type MultipartBody,
} from './request';

export const SESSION_COOKIE = 'desk_session';
export const LANGUAGE_COOKIE = 'desk_language';

export const JSON_BODY_LIMIT = 64_000;
export const CLAIM_START_BODY_LIMIT = 33_000_000;
export const SUPPLIER_FILE_LIMIT = 2_000_000;

export type BodyKind = 'none' | 'json' | 'multipart' | 'csv';

export interface RequestContext {
  method: string;
  path: string;
  url: URL;
  params: Readonly<Record<string, string>>;
  cookies: Readonly<Record<string, string>>;
  audience: Audience;
  language: Language;
  caller: string;
  operator: SignedInOperator | null;
  json: Record<string, unknown>;
  multipart: MultipartBody | null;
  text: string;
  raw: IncomingMessage;
}

export interface Reply {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
}

export interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  pattern: string;
  audience: Audience;
  body?: BodyKind;
  session?: boolean;
  /** An operator screen without a live session goes to the sign-in page instead of 401. */
  signInRedirect?: boolean;
  /** Share paths answer 405 to every other method, because they are read-only. */
  readOnlyPath?: boolean;
  handler: (context: RequestContext) => Promise<Reply>;
}

interface CompiledRoute extends Route {
  matcher: RegExp;
  names: string[];
}

function compile(route: Route): CompiledRoute {
  const names: string[] = [];
  const source = route.pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { ...route, matcher: new RegExp(`^${source}$`), names };
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push(compile(route));
  }

  addAll(routes: readonly Route[]): void {
    for (const route of routes) this.add(route);
  }

  private find(path: string): { route: CompiledRoute; values: string[] }[] {
    const found: { route: CompiledRoute; values: string[] }[] = [];
    for (const route of this.routes) {
      const match = route.matcher.exec(path);
      if (match !== null) found.push({ route, values: match.slice(1) });
    }
    return found;
  }

  async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = (request.method ?? 'GET').toUpperCase();
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const path = decodeURIComponent(url.pathname).replace(/(.)\/+$/, '$1');
    const candidates = this.find(path);
    const audience: Audience = path.startsWith('/api/ops/') || path.startsWith('/ops/') ? 'operator' : 'owner';

    try {
      if (candidates.length === 0) throw apiError(audience, 404, 'not_found');

      const chosen = candidates.find((candidate) => candidate.route.method === method);
      if (chosen === undefined) {
        // A share path is read-only, so every other method is refused there.
        if (candidates.some((candidate) => candidate.route.readOnlyPath === true)) {
          throw apiError(audience, 405, 'read_only');
        }
        throw apiError(audience, 404, 'not_found');
      }

      const reply = await this.run(chosen.route, chosen.values, request, url, path);
      send(response, reply);
    } catch (error) {
      send(response, errorReply(error, audience));
    }
  }

  private async run(
    route: CompiledRoute,
    values: string[],
    request: IncomingMessage,
    url: URL,
    path: string,
  ): Promise<Reply> {
    const params: Record<string, string> = {};
    route.names.forEach((name, index) => {
      params[name] = values[index] ?? '';
    });

    const cookies = readCookies(request);
    const bodyKind = route.body ?? 'none';

    // 413 and 415 come before anything that needs the records.
    let json: Record<string, unknown> = {};
    let multipart: MultipartBody | null = null;
    let text = '';
    if (bodyKind === 'json') {
      requireJson(request, route.audience);
      json = parseJsonBody(await readBody(request, JSON_BODY_LIMIT, 'request_too_large', route.audience), route.audience);
    } else if (bodyKind === 'multipart') {
      multipart = await readMultipart(request, CLAIM_START_BODY_LIMIT, 'request_too_large', route.audience);
    } else if (bodyKind === 'csv') {
      text = (await readBody(request, SUPPLIER_FILE_LIMIT, 'file_too_large', route.audience)).toString('utf8');
    }

    refuseOtherOrigins(request, route.audience);

    // A request with no session cookie is refused without asking the records.
    let operator: SignedInOperator | null = null;
    if (route.session === true) {
      const token = cookies[SESSION_COOKIE];
      const refuse = (): Reply | never => {
        if (route.signInRedirect === true) return { status: 302, headers: { location: '/ops/sign-in' }, body: '' };
        throw apiError(route.audience, 401, 'unauthenticated');
      };
      if (token === undefined) return refuse();
      operator = await liveSession(token, now());
      if (operator === null) return refuse();
    }

    const cookieLanguage = cookies[LANGUAGE_COOKIE];
    const context: RequestContext = {
      method: route.method,
      path,
      url,
      params,
      cookies,
      audience: route.audience,
      language: isLanguage(cookieLanguage) ? cookieLanguage : 'en-GB',
      caller: callerAddress(request),
      operator,
      json,
      multipart,
      text,
      raw: request,
    };
    return route.handler(context);
  }
}

/** Every service outage answers with that service's published status. */
export function errorReply(error: unknown, audience: Audience): Reply {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (error.detail.retryAfter !== undefined) headers['Retry-After'] = String(error.detail.retryAfter);
    return { status: error.status, json: error.toBody(), headers };
  }
  if (error instanceof DatabaseUnavailable) return refusal(audience, 503, 'database_unavailable');
  if (error instanceof StorageUnavailable) return refusal(audience, 503, 'storage_unavailable');
  if (error instanceof BillingUnavailable) return refusal(audience, 503, 'billing_unavailable');
  if (error instanceof MailUnavailable) return refusal(audience, 503, 'mail_unavailable');
  if (error instanceof CarrierFailure) {
    const status = error.fault === 'carrier_timeout' ? 504 : error.fault === 'carrier_malformed' ? 502 : 503;
    return refusal(audience, status, error.fault);
  }
  return refusal(audience, 500, 'desk_error');
}

function refusal(audience: Audience, status: number, code: string): Reply {
  const built = apiError(audience, status, code);
  return { status, json: built.toBody() };
}

export function send(response: ServerResponse, reply: Reply): void {
  if (response.writableEnded) return;
  const headers: Record<string, string> = { ...reply.headers };

  let payload: Buffer;
  if (reply.json !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8';
    payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
  } else if (reply.body !== undefined) {
    headers['content-type'] = reply.contentType ?? 'text/html; charset=utf-8';
    payload = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body, 'utf8');
  } else {
    payload = Buffer.alloc(0);
  }

  headers['content-length'] = String(payload.length);
  headers['x-content-type-options'] = 'nosniff';
  response.writeHead(reply.status, headers);
  response.end(payload);
}
