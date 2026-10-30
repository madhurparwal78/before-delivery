import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  ApiError,
  crossOrigin,
  forbidden,
  invalidJson,
  methodNotAllowed,
  notFound,
  payloadTooLarge,
  unauthenticated,
  unsupportedMediaType,
} from './errors.js';
import { matchRoute, type Route } from './router.js';
import type { Reply, RequestContext } from './context.js';
import { clearedSessionCookieHeader, parseCookies, SESSION_COOKIE, sessionCookieHeader, userForSession } from './session.js';
import { serveStatic } from './static.js';
import { PaymentsUnavailableError } from '../services/killbill.js';
import { StorageUnavailableError } from '../services/storage.js';

const MAX_BODY_BYTES = 65536;
const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const BASE_HEADERS: Record<string, string> = {
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

class BodyTooLarge extends Error {}

function readRawBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function mediaType(header: string | undefined): string | null {
  if (header === undefined) return null;
  const value = header.split(';')[0];
  return value === undefined ? null : value.trim().toLowerCase();
}

/** Boundary checks in precedence order: 413, then 415, then invalid JSON. */
async function parseBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number.parseInt(declared, 10) > MAX_BODY_BYTES) {
    throw payloadTooLarge();
  }
  let raw: Buffer;
  try {
    raw = await readRawBody(request);
  } catch (error) {
    if (error instanceof BodyTooLarge) throw payloadTooLarge();
    throw error;
  }
  if (raw.length === 0) return null;
  if (mediaType(request.headers['content-type']) !== 'application/json') throw unsupportedMediaType();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw invalidJson();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalidJson();
  return parsed as Record<string, unknown>;
}

function ownOriginMatches(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function requestOrigin(request: IncomingMessage): string {
  const host = request.headers.host ?? '127.0.0.1';
  const forwarded = request.headers['x-forwarded-proto'];
  const scheme = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() ?? 'http' : 'http';
  return `${scheme}://${host}`;
}

/**
 * Every API response, including the capability paths, is uncached and sends no
 * referrer; only the built assets are cacheable.
 */
function writeReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    'cache-control': 'no-store',
    ...(reply.headers ?? {}),
  };
  if (reply.setSessionCookie !== undefined) {
    headers['set-cookie'] = sessionCookieHeader(reply.setSessionCookie);
  } else if (reply.clearSessionCookie === true) {
    headers['set-cookie'] = clearedSessionCookieHeader();
  }

  if (reply.body !== undefined) {
    headers['content-type'] = reply.contentType ?? 'application/octet-stream';
    headers['content-length'] = String(reply.body.length);
    response.writeHead(reply.status, headers);
    response.end(reply.body);
    return;
  }
  if (reply.json === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
  headers['content-type'] = 'application/json; charset=utf-8';
  headers['content-length'] = String(payload.length);
  response.writeHead(reply.status, headers);
  response.end(payload);
}

async function handleApi(
  routes: readonly Route[],
  request: IncomingMessage,
  method: string,
  path: string,
  query: URLSearchParams,
): Promise<Reply> {
  const match = matchRoute(routes, method, path);
  if (match.kind === 'method_not_allowed') throw methodNotAllowed();

  const body = await parseBody(request);
  if (STATE_CHANGING.has(method) && !ownOriginMatches(request)) throw crossOrigin();
  if (match.kind === 'no_route') throw notFound();

  const { route, params } = match;
  const cookies = parseCookies(request.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE];
  const bearsCapabilityToken = route.auth === 'token_or_session' && query.has('token');
  const sessionNeeded = route.auth === 'required' || (route.auth === 'token_or_session' && !bearsCapabilityToken);

  let user = null;
  if (!bearsCapabilityToken && sessionToken !== undefined) {
    user = await userForSession(sessionToken);
  }
  if (sessionNeeded && user === null) throw unauthenticated();

  if (route.roles !== undefined && user !== null && !route.roles.includes(user.role)) {
    throw forbidden();
  }

  const ctx: RequestContext = {
    request,
    method,
    path,
    query,
    params,
    body,
    origin: requestOrigin(request),
    user,
    at: new Date(),
  };
  return route.handler(ctx);
}

function replyForError(error: unknown): Reply {
  if (error instanceof ApiError) return { status: error.status, json: error.payload };
  if (error instanceof PaymentsUnavailableError) {
    return { status: 503, json: { error: 'payments_unavailable' } };
  }
  if (error instanceof StorageUnavailableError) {
    return { status: 503, json: { error: 'storage_unavailable' } };
  }
  process.stderr.write(`Unhandled request failure: ${String(error)}\n`);
  return { status: 500, json: { error: 'internal_error' } };
}

export function createHttpServer(routes: readonly Route[]): Server {
  return createServer((request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://placeholder');
    const path = url.pathname;

    void (async () => {
      if (!path.startsWith('/api/')) {
        await serveStatic(method, path, response, BASE_HEADERS);
        return;
      }
      try {
        const reply = await handleApi(routes, request, method, path, url.searchParams);
        writeReply(response, method === 'HEAD' ? { status: reply.status, headers: reply.headers } : reply);
      } catch (error) {
        writeReply(response, replyForError(error));
      }
    })().catch((error: unknown) => {
      process.stderr.write(`Request pipeline failure: ${String(error)}\n`);
      if (!response.headersSent) {
        response.writeHead(500, { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      }
      response.end();
    });
  });
}
