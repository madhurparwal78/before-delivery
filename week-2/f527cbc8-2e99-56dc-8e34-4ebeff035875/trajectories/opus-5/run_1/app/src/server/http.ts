import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { config, limits, type RateBucket } from './config.js';
import { now } from './clock.js';
import { withClient } from './db.js';
import {
  ApiError,
  ImportInvalidError,
  ValidationError,
  forbidden,
  insufficientScope,
  payloadTooLarge,
  unauthenticated,
  unsupportedMediaType,
} from './errors.js';
import {
  SESSION_COOKIE,
  callerFromSession,
  callerFromToken,
  type Caller,
  type Role,
  type TokenScope,
} from './auth.js';
import {
  allowanceHeaders,
  consumeAllowance,
  headerReading,
  rateLimited,
  vetGuessLimit,
  type AllowanceReading,
} from './ratelimit.js';
import { log } from './log.js';

export type BodyKind = 'none' | 'json' | 'csv' | 'multipart' | 'octet';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Roles that may ever call this route; others are refused before any lookup. */
  roles?: readonly Role[];
  /** The narrowest token scope that covers this route; 'none' means tokens may never call it. */
  tokenAccess?: TokenScope | 'none';
  bodyKind?: BodyKind;
  rate?: RateBucket;
  needsIdempotency?: boolean;
  /** Vet reads carry no session and skip authentication entirely. */
  openToVets?: boolean;
  handler: (ctx: Ctx) => Promise<RouteResult>;
}

export interface JsonResult {
  kind: 'json';
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface EmptyResult {
  kind: 'empty';
  status: number;
  headers?: Record<string, string>;
}

export interface BytesResult {
  kind: 'bytes';
  status: number;
  body: Buffer;
  contentType: string;
  headers?: Record<string, string>;
}

export interface TakenOverResult {
  kind: 'taken_over';
}

export type RouteResult = JsonResult | EmptyResult | BytesResult | TakenOverResult;

export const json = (status: number, body: unknown, headers?: Record<string, string>): JsonResult => ({
  kind: 'json',
  status,
  body,
  headers,
});

export const empty = (status: number, headers?: Record<string, string>): EmptyResult => ({
  kind: 'empty',
  status,
  headers,
});

export interface Ctx {
  requestId: string;
  method: string;
  url: URL;
  params: Record<string, string>;
  address: string;
  userAgent: string;
  raw: Buffer;
  caller: Caller;
  /** Null when the route does not require authentication. */
  maybeCaller: Caller | null;
  idempotencyKey: string | null;
  header(name: string): string | null;
  body<T = Record<string, unknown>>(): T;
  req: IncomingMessage;
  res: ServerResponse;
}

interface CompiledRoute extends RouteDefinition {
  segments: readonly string[];
}

const routes: CompiledRoute[] = [];

export function route(definition: RouteDefinition): void {
  routes.push({ ...definition, segments: definition.path.split('/').filter((part) => part !== '') });
}

function matchRoute(method: string, pathname: string): { route: CompiledRoute; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  let methodMismatch = false;
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const segment = candidate.segments[index] as string;
      const part = parts[index] as string;
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(part);
      else if (segment !== part) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (candidate.method !== method) {
      methodMismatch = true;
      continue;
    }
    return { route: candidate, params };
  }
  return methodMismatch ? null : null;
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function bodyLimitFor(kind: BodyKind, contentType: string | null): number {
  switch (kind) {
    case 'json':
      return limits.jsonBodyBytes;
    case 'csv':
      return limits.importBytes;
    case 'multipart':
      return limits.multipartBytes;
    case 'octet':
      return config.uploadChunkBytes;
    case 'none':
      return contentType === null ? 0 : limits.jsonBodyBytes;
  }
}

/**
 * Reads a body up to its limit. An oversized body is drained rather than cut off, so
 * the 413 reaches the caller on a healthy connection; a body far past the limit is
 * dropped instead of read to the end.
 */
const DRAIN_ALLOWANCE_BYTES = 1_000_000;

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let oversized = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      oversized = true;
      chunks.length = 0;
      if (total > limit + DRAIN_ALLOWANCE_BYTES) {
        req.destroy();
        break;
      }
      continue;
    }
    chunks.push(buffer);
  }
  if (oversized) throw payloadTooLarge();
  return Buffer.concat(chunks);
}

function contentTypeMatches(kind: BodyKind, raw: string | null): boolean {
  const value = (raw ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  switch (kind) {
    case 'json':
      return value === 'application/json';
    case 'csv':
      return value === 'text/csv';
    case 'multipart':
      return value === 'multipart/form-data';
    case 'octet':
      return value === 'application/octet-stream';
    case 'none':
      return true;
  }
}

function peerAddress(req: IncomingMessage): string {
  // Forwarding headers are ignored: the address is the connection's peer.
  return req.socket.remoteAddress ?? 'unknown';
}

function isVetPath(pathname: string): boolean {
  return pathname === '/api/vet' || pathname.startsWith('/api/vet/');
}

let draining = false;

export function startDraining(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}

let inFlight = 0;
const idleWaiters: (() => void)[] = [];

export function inFlightCount(): number {
  return inFlight;
}

export function whenIdle(): Promise<void> {
  if (inFlight === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function releaseInFlight(): void {
  inFlight -= 1;
  if (inFlight === 0) {
    while (idleWaiters.length > 0) idleWaiters.shift()?.();
  }
}

function requestIdOf(req: IncomingMessage): string {
  const given = req.headers['x-request-id'];
  const value = Array.isArray(given) ? given[0] : given;
  if (value !== undefined && /^[A-Za-z0-9-]{8,64}$/.test(value)) return value;
  return randomUUID();
}

export interface StaticHandler {
  (pathname: string): { body: Buffer; contentType: string; headers?: Record<string, string> } | null;
}

let serveStatic: StaticHandler = () => null;
let appShell: (() => { body: Buffer; contentType: string }) | null = null;

export function configureStatic(handler: StaticHandler, shell: () => { body: Buffer; contentType: string }): void {
  serveStatic = handler;
  appShell = shell;
}

/** Paths that render the single-page app. */
const APP_PATHS = [
  /^\/$/,
  /^\/sign-in$/,
  /^\/days\/[^/]+$/,
  /^\/horses$/,
  /^\/horses\/[^/]+$/,
  /^\/invoices$/,
  /^\/prices$/,
  /^\/dashboard$/,
  /^\/vet\/[^/]+$/,
];

function isAppPath(pathname: string): boolean {
  return APP_PATHS.some((pattern) => pattern.test(pathname));
}

function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: Buffer | null,
): void {
  if (res.headersSent) return;
  res.writeHead(status, headers);
  if (body === null) res.end();
  else res.end(body);
}

function errorFrom(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  log.error('unhandled', { detail: String(error instanceof Error ? error.stack : error) });
  return new ApiError(500, 'internal_error');
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = requestIdOf(req);
  const started = Date.now();
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let status = 500;
  let takenOver = false;
  inFlight += 1;

  const finish = (
    code: number,
    headers: Record<string, string>,
    body: Buffer | null,
  ): void => {
    status = code;
    send(res, code, { 'X-Request-Id': requestId, ...headers }, body);
  };

  const sendJson = (code: number, body: unknown, headers: Record<string, string> = {}): void => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    finish(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(payload.length),
      ...headers,
    }, payload);
  };

  try {
    // Liveness answers with no dependency check at all, draining or not.
    if (url.pathname === '/healthz' || url.pathname === '/api/health') {
      sendJson(200, { status: 'ok' });
      return;
    }

    const matched = matchRoute(method, url.pathname);

    if (url.pathname === '/readyz') {
      const { readiness } = await import('./routes/health.js');
      const result = await readiness();
      sendJson(result.status, result.body);
      return;
    }

    // While draining, every new request other than readiness writes nothing.
    if (draining) {
      sendJson(503, { error: 'shutting_down' });
      return;
    }

    if (matched === null) {
      if (method === 'GET') {
        const asset = serveStatic(url.pathname);
        if (asset !== null) {
          finish(200, { 'content-type': asset.contentType, ...(asset.headers ?? {}) }, asset.body);
          return;
        }
        if (isAppPath(url.pathname) && appShell !== null) {
          const shell = appShell();
          finish(200, { 'content-type': shell.contentType, 'cache-control': 'no-store' }, shell.body);
          return;
        }
      }
      sendJson(404, { error: 'not_found' });
      return;
    }

    const definition = matched.route;
    const vetPath = isVetPath(url.pathname);

    // 1. Same origin only, on any non-GET request.
    if (method !== 'GET') {
      const origin = req.headers.origin;
      if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
        let sameOrigin = false;
        try {
          const given = new URL(origin);
          sameOrigin = given.host === url.host;
        } catch {
          sameOrigin = false;
        }
        if (!sameOrigin) {
          sendJson(403, { error: 'cross_origin' });
          return;
        }
      }
    }

    const readings: (AllowanceReading | null)[] = [];
    const address = peerAddress(req);

    // 3. On vet paths, the guess limit, then the address allowance.
    if (vetPath) {
      const blocked = await vetGuessLimit(address);
      if (blocked !== null) {
        sendJson(429, { error: 'rate_limited' }, { 'Retry-After': String(blocked) });
        return;
      }
    }

    if (definition.rate !== undefined) {
      const addressReading = await consumeAllowance(definition.rate, 'address', address);
      readings.push(addressReading);
      if (addressReading !== null && !addressReading.allowed) throw rateLimited(addressReading);
    }

    // 4. Body shape: 413, then 415.
    const bodyKind = definition.bodyKind ?? 'none';
    const contentType = req.headers['content-type'] ?? null;
    const raw =
      method === 'GET' || bodyKind === 'none'
        ? Buffer.alloc(0)
        : await readBody(req, bodyLimitFor(bodyKind, contentType));
    if (bodyKind !== 'none' && raw.length > 0 && !contentTypeMatches(bodyKind, contentType)) {
      throw unsupportedMediaType();
    }
    if (bodyKind === 'json' && raw.length === 0 && method !== 'GET' && method !== 'DELETE') {
      // An absent JSON body is read as an empty object.
    }

    let parsedBody: Record<string, unknown> | null = null;
    const bodyAccessor = <T,>(): T => {
      if (parsedBody === null) {
        if (raw.length === 0) parsedBody = {};
        else {
          try {
            const value: unknown = JSON.parse(raw.toString('utf8'));
            parsedBody = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
          } catch {
            throw new ValidationError({ body: 'This is required.' });
          }
        }
      }
      return parsedBody as T;
    };

    // The sign_in user allowance is keyed by the lower-cased submitted email.
    if (definition.rate === 'sign_in') {
      const submitted = bodyAccessor<{ email?: unknown }>().email;
      const key = typeof submitted === 'string' ? submitted.trim().toLowerCase() : '';
      const reading = await consumeAllowance('sign_in', 'user', key);
      readings.push(reading);
      if (reading !== null && !reading.allowed) throw rateLimited(reading);
    }

    // 5. Authentication. Vet paths need none and skip this step and the next.
    let caller: Caller | null = null;
    if (definition.openToVets !== true && definition.roles !== undefined) {
      const bearer = req.headers.authorization;
      const sessionId = readCookie(req, SESSION_COOKIE);
      caller = await withClient(async (db) => {
        if (typeof bearer === 'string' && bearer.toLowerCase().startsWith('bearer ')) {
          return await callerFromToken(db, bearer.slice(7).trim());
        }
        if (sessionId !== null) return await callerFromSession(db, sessionId);
        return null;
      });
      if (caller === null) throw unauthenticated();

      // 6. Role and scope, before any lookup.
      if (!definition.roles.includes(caller.role)) throw forbidden();
      if (caller.tokenId !== null) {
        const access = definition.tokenAccess ?? 'none';
        if (access === 'none') throw insufficientScope();
        if (access === 'billing' && caller.tokenScope !== 'billing') throw insufficientScope();
      }
    }

    // 7. The other user allowances.
    if (definition.rate !== undefined && definition.rate !== 'sign_in' && caller !== null) {
      const reading = await consumeAllowance(definition.rate, 'user', caller.userId);
      readings.push(reading);
      if (reading !== null && !reading.allowed) throw rateLimited(reading);
    }

    const userAgentHeader = req.headers['user-agent'];
    const ctx: Ctx = {
      requestId,
      method,
      url,
      params: matched.params,
      address,
      userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : '',
      raw,
      caller: caller as Caller,
      maybeCaller: caller,
      idempotencyKey: (() => {
        const given = req.headers['idempotency-key'];
        const value = Array.isArray(given) ? given[0] : given;
        return value === undefined || value === '' ? null : value;
      })(),
      header: (name) => {
        const value = req.headers[name.toLowerCase()];
        return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
      },
      body: bodyAccessor,
      req,
      res,
    };

    if (definition.needsIdempotency === true && ctx.idempotencyKey === null) {
      throw new ApiError(400, 'idempotency_key_required');
    }

    const result = await definition.handler(ctx);
    const reading = headerReading(readings);
    const rateHeaders = reading === null ? {} : allowanceHeaders(reading);

    switch (result.kind) {
      case 'json':
        sendJson(result.status, result.body, { ...rateHeaders, ...(result.headers ?? {}) });
        return;
      case 'empty':
        finish(result.status, { ...rateHeaders, ...(result.headers ?? {}) }, null);
        return;
      case 'bytes':
        finish(
          result.status,
          {
            'content-type': result.contentType,
            'content-length': String(result.body.length),
            ...rateHeaders,
            ...(result.headers ?? {}),
          },
          result.body,
        );
        return;
      case 'taken_over':
        // An event stream owns its response from here on.
        takenOver = true;
        status = res.statusCode;
        return;
    }
  } catch (error) {
    const api = errorFrom(error);
    const body =
      api instanceof ValidationError || api instanceof ImportInvalidError ? api.body() : api.body();
    sendJson(api.status, body, api.headers as Record<string, string>);
  } finally {
    releaseInFlight();
    if (!takenOver && !res.writableEnded) res.end();
    log.request({
      request_id: requestId,
      method,
      path: url.pathname,
      status,
      duration_ms: Date.now() - started,
    });
  }
}

export function currentInstant(): Date {
  return now();
}
