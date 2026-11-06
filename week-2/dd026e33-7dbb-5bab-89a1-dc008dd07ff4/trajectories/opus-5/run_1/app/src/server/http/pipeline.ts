import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { SESSION_COOKIE, JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT } from '../config';
import type { Role, User } from '../../shared/types';
import type { UnitSettings } from '../../shared/units';
import { lookupSession, type LiveSession } from '../domain/session';
import { projectForOwner } from '../domain/projection';
import { StorageUnavailable } from '../providers/s3';
import { BillingUnavailable } from '../providers/killbill';
import { MailUnavailable } from '../providers/smtp';
import {
  MultipartReader,
  contentType,
  declaredLength,
  multipartBoundary,
  readJsonBody,
} from './body';
import { ApiError, ClientGone, fail } from './errors';
import { replayOrReserve, releaseReservation, storeResponse } from './idempotency';

export type BodyKind = 'none' | 'json' | 'upload';

export interface RequestContext {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: Record<string, unknown>;
  readonly multipart: MultipartReader | null;
  readonly request: IncomingMessage;
  readonly session: LiveSession | null;
  readonly now: Date;
  readonly idempotencyKey: string | null;
  user(): User;
  units(): UnitSettings;
  requireRole(...roles: Role[]): void;
  header(name: string): string | null;
}

export type HandlerResult =
  | { kind: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | {
      kind: 'bytes';
      status: number;
      body: Buffer;
      contentType: string;
      headers?: Record<string, string>;
    }
  | { kind: 'empty'; status: number; headers?: Record<string, string> };

export interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly body: BodyKind;
  readonly session: 'required' | 'public';
  readonly idempotent?: boolean;
  handle(ctx: RequestContext): Promise<HandlerResult>;
}

interface Matched {
  readonly route: Route;
  readonly params: Record<string, string>;
}

const routes: Route[] = [];

export function register(list: readonly Route[]): void {
  routes.push(...list);
}

function match(method: string, path: string): Matched | 'path-known' | null {
  let pathKnown = false;
  for (const route of routes) {
    const params = matchPattern(route.pattern, path);
    if (params === null) continue;
    pathKnown = true;
    if (route.method === method) return { route, params };
  }
  return pathKnown ? 'path-known' : null;
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, expected] of patternParts.entries()) {
    const actual = pathParts[index] ?? '';
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

async function forOwner(
  result: HandlerResult,
  session: LiveSession | null,
): Promise<HandlerResult> {
  if (result.kind !== 'json' || session === null || session.user.role !== 'owner') return result;
  return { ...result, body: await projectForOwner(result.body) };
}

function sendResult(response: ServerResponse, result: HandlerResult): void {
  const headers: Record<string, string> = { ...(result.headers ?? {}) };
  if (result.kind === 'json') {
    const text = JSON.stringify(result.body);
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = String(Buffer.byteLength(text));
    response.writeHead(result.status, headers);
    response.end(text);
    return;
  }
  if (result.kind === 'bytes') {
    headers['content-type'] = result.contentType;
    headers['content-length'] = String(result.body.length);
    response.writeHead(result.status, headers);
    response.end(result.body);
    return;
  }
  response.writeHead(result.status, headers);
  response.end();
}

function sendError(response: ServerResponse, error: ApiError): void {
  sendResult(response, { kind: 'json', status: error.status, body: error.body });
}

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StorageUnavailable) return fail.storageUnavailable();
  if (error instanceof BillingUnavailable) return fail.billingUnavailable();
  if (error instanceof MailUnavailable) return fail.mailUnavailable();
  return new ApiError(500, { error: 'server_error' });
}

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  query: URLSearchParams,
): Promise<void> {
  const method = request.method ?? 'GET';
  try {
    const found = match(method, path);
    const matched = found === null || found === 'path-known' ? null : found;
    const route = matched === null ? null : matched.route;

    // 1. Size and content type.
    const length = declaredLength(request);
    const limit = route?.body === 'upload' ? UPLOAD_BODY_LIMIT : JSON_BODY_LIMIT;
    if (length !== null && length > limit) throw fail.payloadTooLarge();
    if (route !== null && route.body === 'json' && length !== null && length > 0) {
      if (!contentType(request).includes('application/json')) throw fail.unsupportedMediaType();
    }
    if (route !== null && route.body === 'upload' && multipartBoundary(request) === null) {
      throw fail.unsupportedMediaType();
    }

    // 2. A state-changing request from another origin.
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(request)) throw fail.forbidden();

    if (route === null || matched === null) throw fail.notFound();

    // 3. Session.
    let session: LiveSession | null = null;
    if (route.session === 'required') {
      const lookup = await lookupSession(readCookie(request, SESSION_COOKIE));
      if (lookup.kind === 'revoked') throw fail.accessRevoked();
      if (lookup.kind === 'expired') throw fail.sessionExpired();
      if (lookup.kind === 'none') throw fail.unauthenticated();
      session = lookup.session;
    }

    const body = route.body === 'json' ? await readJsonBody(request) : {};
    const boundary = route.body === 'upload' ? multipartBoundary(request) : null;
    const idempotencyKey = headerValue(request, 'idempotency-key');

    const ctx: RequestContext = {
      method,
      path,
      params: matched.params,
      query,
      body,
      multipart: boundary === null ? null : new MultipartReader(request, boundary),
      request,
      session,
      now: new Date(),
      idempotencyKey,
      user() {
        if (session === null) throw fail.unauthenticated();
        return session.user;
      },
      units() {
        if (session === null) throw fail.unauthenticated();
        return session.units;
      },
      requireRole(...roles: Role[]) {
        if (session === null) throw fail.unauthenticated();
        if (!roles.includes(session.user.role)) throw fail.forbidden();
      },
      header(name: string) {
        return headerValue(request, name);
      },
    };

    // 4. Idempotent replay.
    if (route.idempotent === true && session !== null && idempotencyKey !== null) {
      const hash = hashBody(body);
      const reservation = await replayOrReserve(
        session.user.id,
        route.pattern,
        idempotencyKey,
        hash,
      );
      if (reservation.kind === 'replay') {
        sendResult(response, {
          kind: 'json',
          status: reservation.status,
          body: JSON.parse(reservation.body) as unknown,
        });
        return;
      }
      if (reservation.kind === 'conflict') throw fail.conflict('idempotency_conflict');
      try {
        const result = await forOwner(await route.handle(ctx), session);
        if (result.kind === 'json' && result.status >= 200 && result.status < 300) {
          await storeResponse(
            session.user.id,
            route.pattern,
            idempotencyKey,
            result.status,
            JSON.stringify(result.body),
          );
        } else {
          await releaseReservation(session.user.id, route.pattern, idempotencyKey);
        }
        sendResult(response, result);
      } catch (error) {
        await releaseReservation(session.user.id, route.pattern, idempotencyKey);
        throw error;
      }
      return;
    }

    sendResult(response, await forOwner(await route.handle(ctx), session));
  } catch (error) {
    if (error instanceof ClientGone) {
      response.destroy();
      return;
    }
    const apiError = asApiError(error);
    if (apiError.status === 500) {
      process.stderr.write(`request failed: ${String(error)}\n`);
    }
    if (!response.headersSent) sendError(response, apiError);
    else response.end();
  }
}

export function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}
