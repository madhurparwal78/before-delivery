import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config.js';
import type { RequestContext, Reply, Route, Surface } from './router.js';
import { Router, contextBase } from './router.js';
import {
  ApiError,
  fieldError,
  isApiError,
  methodNotAllowed,
  notFound,
  unknownParameter,
  validationFailed,
} from './errors.js';
import {
  MAX_JSON_BYTES,
  MAX_MULTIPART_BYTES,
  contentTypeOf,
  parseJsonObject,
  parseMultipart,
  readBody,
} from './body.js';
import type { MultipartForm } from './body.js';
import { IDEMPOTENCY_KEY_RE } from '../domain/identifiers.js';
import { loadSession, sessionSecret } from '../db/users.js';
import { unsign } from './cookies.js';
import type { Session } from '../domain/session.js';
import { renderErrorPage } from '../pages/error-page.js';
import { StorageError } from '../services/s3.js';
import { SearchError } from '../services/search.js';
import { BillingError } from '../services/killbill.js';

export const SESSION_COOKIE = 'ts_session';

const router = new Router();

export function route(definition: Route): void {
  router.add(definition);
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function ownOrigins(req: IncomingMessage): readonly string[] {
  const host = req.headers.host ?? '';
  const out = [`http://${host}`, `https://${host}`, config.publicUrl];
  return out;
}

/** A state-changing request from another origin is refused. */
function checkOrigin(req: IncomingMessage, method: string): void {
  if (!STATE_CHANGING.has(method)) return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  if (!ownOrigins(req).includes(origin)) throw new ApiError('cross_origin');
}

function checkQuery(route: Route, url: URL): void {
  if (route.query === undefined) return;
  for (const name of url.searchParams.keys()) {
    if (!route.query.includes(name)) throw unknownParameter(name);
  }
}

function checkBodyFields(route: Route, body: Record<string, unknown>): void {
  const allowed = route.fields;
  if (allowed === undefined) return;
  const unknown = Object.keys(body).filter((name) => !allowed.includes(name));
  if (unknown.length > 0) {
    throw validationFailed(unknown.map((name) => fieldError(name, 'unknown')));
  }
}

function checkIdempotencyKey(req: IncomingMessage, route: Route): string | null {
  if (route.needsIdempotency !== true) return null;
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (key === undefined || key === '') throw new ApiError('idempotency_key_required');
  if (!IDEMPOTENCY_KEY_RE.test(key)) throw new ApiError('idempotency_key_invalid');
  return key;
}

function checkContentType(req: IncomingMessage, route: Route, bodyLength: number): void {
  const type = contentTypeOf(req);
  if (route.body === 'json') {
    if (type !== 'application/json') throw new ApiError('unsupported_media_type');
    return;
  }
  if (route.body === 'multipart') {
    if (type !== 'multipart/form-data') throw new ApiError('unsupported_media_type');
    return;
  }
  // A read API GET carries neither a body nor a content type.
  if (route.surface === 'read-api' && (bodyLength > 0 || type !== '')) {
    throw new ApiError('unsupported_media_type');
  }
}

async function readSession(cookies: Readonly<Record<string, string>>): Promise<Session | null> {
  const signed = cookies[SESSION_COOKIE];
  if (signed === undefined) return null;
  const id = unsign(signed, await sessionSecret());
  return id === null ? null : loadSession(id);
}

function prefersHtml(req: IncomingMessage): boolean {
  const accept = req.headers.accept ?? '';
  return accept.includes('text/html');
}

function errorReply(error: ApiError, surface: Surface, ctx: RequestContext | null): Reply {
  const headers = { ...error.headers };
  if (surface === 'page') {
    return {
      status: error.status,
      headers,
      html: renderErrorPage(error, ctx),
    };
  }
  return { status: error.status, headers, json: error.body() };
}

function send(res: ServerResponse, reply: Reply, head: boolean): void {
  const headers: Record<string, string> = { ...reply.headers };
  let body: Buffer | null = null;

  if (reply.location !== undefined) {
    headers.Location = reply.location;
  } else if (reply.json !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    body = Buffer.from(JSON.stringify(reply.json), 'utf8');
  } else if (reply.html !== undefined) {
    headers['Content-Type'] = 'text/html; charset=utf-8';
    body = Buffer.from(reply.html, 'utf8');
  } else if (reply.text !== undefined) {
    headers['Content-Type'] = reply.contentType ?? 'text/plain; charset=utf-8';
    body = Buffer.from(reply.text, 'utf8');
  } else if (reply.bytes !== undefined) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    body = reply.bytes;
  }

  if (body !== null) headers['Content-Length'] = String(body.length);
  if (reply.cookies !== undefined && reply.cookies.length > 0) {
    res.setHeader('Set-Cookie', [...reply.cookies]);
  }
  res.writeHead(reply.status, headers);
  if (head || body === null) res.end();
  else res.end(body);
}

/** Pages may be framed only by the app's own origin, except the embed page. */
function frameHeaders(path: string): Record<string, string> {
  if (path.startsWith('/embed/')) return {};
  return { 'Content-Security-Policy': "frame-ancestors 'self'" };
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const rawUrl = req.url ?? '/';
  let url: URL;
  try {
    url = new URL(rawUrl, `http://${req.headers.host ?? '127.0.0.1'}`);
  } catch {
    send(res, { status: 404, json: notFound().body() }, false);
    return;
  }

  const method = (req.method ?? 'GET').toUpperCase();
  const head = method === 'HEAD';
  const lookupMethod = head ? 'GET' : method;
  const matched = router.match(lookupMethod, url.pathname);

  const base = contextBase(req, res, url);
  const htmlWanted = prefersHtml(req);

  if (matched === null) {
    send(res, errorReply(notFound(), htmlWanted ? 'page' : 'api', null), head);
    return;
  }
  if ('allow' in matched) {
    send(
      res,
      errorReply(methodNotAllowed(matched.allow), htmlWanted ? 'page' : 'api', null),
      head,
    );
    return;
  }

  const { route: matchedRoute, params } = matched;
  let ctx: RequestContext | null = null;

  try {
    const limit = matchedRoute.body === 'multipart' ? MAX_MULTIPART_BYTES : MAX_JSON_BYTES;
    const rawBody = await readBody(req, limit);
    checkContentType(req, matchedRoute, rawBody.length);
    checkQuery(matchedRoute, url);
    const idempotencyKey = checkIdempotencyKey(req, matchedRoute);
    checkOrigin(req, method);

    let body: Record<string, unknown> = {};
    let form: MultipartForm | null = null;
    if (matchedRoute.body === 'json') {
      body = parseJsonObject(rawBody);
      checkBodyFields(matchedRoute, body);
    } else if (matchedRoute.body === 'multipart') {
      form = parseMultipart(req, rawBody);
    }

    ctx = {
      ...base,
      params,
      surface: matchedRoute.surface,
      rawBody,
      body,
      form,
      idempotencyKey,
      session: await readSession(base.cookies),
    };

    const reply = await matchedRoute.handler(ctx);
    const headers = { ...frameHeaders(url.pathname), ...reply.headers };
    send(res, { ...reply, headers }, head);
  } catch (error) {
    const translated = asApiError(error);
    if (translated === null) {
      process.stderr.write(`Request failed: ${String(error)}\n`);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal error');
      return;
    }
    send(res, errorReply(translated, matchedRoute.surface, ctx), head);
  }
}

/** An unreachable provider answers its published 503 wherever it is reached. */
function asApiError(error: unknown): ApiError | null {
  if (isApiError(error)) return error;
  if (error instanceof StorageError) return new ApiError('storage_unavailable');
  if (error instanceof SearchError) return new ApiError('search_unavailable');
  if (error instanceof BillingError) return new ApiError('billing_unavailable');
  return null;
}
