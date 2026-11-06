import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from '../config.js';
import { now } from '../clock.js';
import { databaseIsUp, ensureDatabaseReady, withTransaction } from '../db.js';
import { findAccountById, clanIdOf, constantTimeEqual } from '../domain/accounts.js';
import { loadSession, SESSION_COOKIE, type SessionRecord } from '../domain/sessions.js';
import { mailIsUp } from '../mail/queue.js';
import { ApiError, errorBody } from './errors.js';
import {
  DeferredFailure,
  lookupStored,
  ReplayStored,
  storeFailure,
  storeResponse,
  type IdempotencyScope
} from './idempotency.js';
import { routes } from '../routes/index.js';
import type { Method, Reply, Route } from './route.js';
import { loadClientAssets, securityHeaders, serveStatic } from './static.js';
import { isValidIdempotencyKey, isValidPathId } from './validate.js';
import { FIELD_MESSAGES } from '../../shared/messages.js';

const MAX_BODY_BYTES = 65_536;
const STATE_CHANGING: readonly string[] = ['POST', 'PATCH', 'DELETE'];

type MatchedRoute = { route: Route; params: Record<string, string> };

function matchRoute(method: string, path: string): MatchedRoute | null {
  const segments = path.split('/').filter((part) => part.length > 0);
  for (const route of routes) {
    const patternSegments = route.pattern.split('/').filter((part) => part.length > 0);
    if (patternSegments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < patternSegments.length; index += 1) {
      const pattern = patternSegments[index] ?? '';
      const segment = segments[index] ?? '';
      if (pattern.startsWith(':')) params[pattern.slice(1)] = segment;
      else if (pattern !== segment) {
        matched = false;
        break;
      }
    }
    if (matched && route.method === method) return { route, params };
  }
  return null;
}

function cookieFrom(request: IncomingMessage): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

async function readRawBody(request: IncomingMessage): Promise<string> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
    throw new ApiError('payload_too_large');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new ApiError('payload_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseBody(raw: string, contentType: string | undefined): Record<string, unknown> {
  if (raw.length === 0) return {};
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (mime !== 'application/json') throw new ApiError('unsupported_media_type');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError('malformed_json');
  }
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  const allowed = new Set<string>([new URL(config.publicUrl).origin]);
  const host = request.headers.host;
  if (host !== undefined) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  return allowed.has(origin);
}

function sendReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | number> = {
    ...securityHeaders(),
    ...(reply.headers ?? {})
  };
  if (reply.setSessionCookie) headers['Set-Cookie'] = reply.setSessionCookie;
  if (reply.status === 204 || reply.body === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  const body = Buffer.from(JSON.stringify(reply.body), 'utf8');
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = body.length;
  response.writeHead(reply.status, headers);
  response.end(body);
}

function sendError(response: ServerResponse, error: ApiError): void {
  const headers: Record<string, string> = {};
  if (error.retryAfterSeconds !== null) {
    headers['Retry-After'] = String(error.retryAfterSeconds);
  }
  sendReply(response, { status: error.status, body: errorBody(error), headers });
}

async function runApi(
  request: IncomingMessage,
  path: string,
  query: URLSearchParams
): Promise<Reply> {
  const method = request.method ?? 'GET';
  const at = now();

  if (path === '/api/health' && method === 'GET') {
    return { status: 200, body: { status: 'ok' } };
  }
  if (path === '/api/status' && method === 'GET') {
    return {
      status: 200,
      body: { database: databaseIsUp() ? 'up' : 'down', mail: mailIsUp() ? 'up' : 'down' }
    };
  }

  const raw = await readRawBody(request);
  const body = parseBody(raw, request.headers['content-type']);

  await ensureDatabaseReady();

  const matched = matchRoute(method, path);
  const sessionId = cookieFrom(request);
  const keyHeader = request.headers['idempotency-key'];
  const idempotencyKey = typeof keyHeader === 'string' ? keyHeader : null;

  const runWith = async (route: Route | null, params: Record<string, string>): Promise<Reply> =>
    withTransaction(async (client) => {
      const session: SessionRecord | null = sessionId
        ? await loadSession(client, sessionId, at)
        : null;

      const authLevel = route?.auth ?? 'public';
      if (authLevel !== 'public' && (session === null || session.accountId === null)) {
        throw new ApiError('unauthenticated');
      }

      if (STATE_CHANGING.includes(method)) {
        if (!originAllowed(request)) throw new ApiError('csrf_failed');
        const header = request.headers['x-csrf-token'];
        const token = typeof header === 'string' ? header : '';
        if (session === null || !constantTimeEqual(token, session.csrfToken)) {
          throw new ApiError('csrf_failed');
        }
      }

      const account =
        session !== null && session.accountId !== null
          ? await findAccountById(client, session.accountId)
          : null;

      if (authLevel !== 'public' && account === null) throw new ApiError('unauthenticated');

      if (route !== null && route.auth === 'operator' && account?.role !== 'operator') {
        throw new ApiError('forbidden');
      }

      if (path.startsWith('/api/clan/') && account !== null) {
        const clanId = await clanIdOf(client, account.id);
        if (clanId === null) throw new ApiError('not_in_clan');
      }

      if (route === null) throw new ApiError('not_found');
      for (const [name, value] of Object.entries(params)) {
        if (name.endsWith('Id') || name === 'id') {
          if (!isValidPathId(value)) throw new ApiError('not_found');
        }
      }

      if (route.auth === 'verified' && account !== null && !account.verified) {
        throw new ApiError('email_not_verified');
      }

      const base = {
        method: method as Method,
        path,
        params,
        query,
        body,
        rawBody: raw,
        now: at,
        idempotencyKey
      };

      if (route.auth === 'public') {
        return route.handler({ ...base, session, account }, client);
      }
      if (session === null || account === null) throw new ApiError('unauthenticated');

      let scope: IdempotencyScope | null = null;
      if (route.requiresKey === true) {
        if (idempotencyKey === null || !isValidIdempotencyKey(idempotencyKey)) {
          throw new ApiError('validation_failed', {
            errors: { 'Idempotency-Key': FIELD_MESSAGES.idempotencyKey }
          });
        }
        scope = {
          accountId: account.id,
          method,
          path,
          key: idempotencyKey,
          body
        };
        const stored = await lookupStored(client, scope);
        if (stored !== null) return stored;
      }

      try {
        const reply = await route.handler({ ...base, session, account }, client);
        if (scope !== null && reply.status < 500) {
          await storeResponse(client, scope, reply, at);
        }
        return reply;
      } catch (error) {
        if (scope !== null && error instanceof ApiError && error.status < 500) {
          throw new DeferredFailure(scope, error);
        }
        throw error;
      }
    });

  try {
    return await runWith(matched?.route ?? null, matched?.params ?? {});
  } catch (error) {
    if (error instanceof ReplayStored) {
      const scope = error.scope;
      return withTransaction(async (client) => {
        const stored = await lookupStored(client, scope);
        if (stored === null) throw new ApiError('internal');
        return stored;
      });
    }
    if (error instanceof DeferredFailure) {
      await storeFailure(error.scope, error.failure, errorBody(error.failure), at);
      throw error.failure;
    }
    throw error;
  }
}

export async function startHttpServer(): Promise<void> {
  await loadClientAssets();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) {
      serveStatic(url.pathname === '/' ? '/index.html' : url.pathname, response);
      return;
    }
    void runApi(request, url.pathname, url.searchParams)
      .then((reply) => sendReply(response, reply))
      .catch((error: unknown) => {
        if (error instanceof ApiError) {
          sendError(response, error);
          return;
        }
        process.stderr.write(`unhandled request failure: ${String(error)}\n`);
        sendError(response, new ApiError('internal'));
      });
  });
  await new Promise<void>((resolve) => {
    server.listen(config.port, '0.0.0.0', resolve);
  });
}
