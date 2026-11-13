import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ApiError } from '../domain/errors.js';
import { sentences } from '../domain/sentences.js';
import { databaseAvailable } from '../db/pool.js';
import { accountForSession, type AccountRecord } from '../db/repo.js';

export const SESSION_COOKIE = 'interval_session';
const MAX_JSON_BYTES = 1_000_000;
const MAX_UPLOAD_BYTES = 8_000_000;

export interface Reply {
  status: number;
  body?: unknown;
  text?: string;
  bytes?: Buffer;
  headers?: Record<string, string>;
  location?: string;
}

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: Buffer;
  bodyTooLarge: boolean;
  headers: IncomingMessage['headers'];
  clientAddress: string;
  sessionToken: string | null;
  account: AccountRecord | null;
  setCookie: string | null;
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  publicRoute: boolean;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler): void {
  routes.push({ method, segments: pattern.split('/'), handler, publicRoute: true });
}

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/');
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const segment = candidate.segments[index];
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(parts[index]);
        continue;
      }
      if (segment !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function readBody(req: IncomingMessage, limit: number): Promise<{ body: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) {
      tooLarge = true;
      break;
    }
    chunks.push(buffer);
  }
  if (tooLarge) req.destroy();
  return { body: Buffer.concat(chunks), tooLarge };
}

export function jsonBody(ctx: Ctx): Record<string, unknown> {
  if (ctx.body.byteLength === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.body.toString('utf8'));
  } catch {
    throw new ApiError(400, 'bad_json', 'That request body is not JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, 'bad_json', 'That request body is not a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function send(res: ServerResponse, reply: Reply, extraHeaders: Record<string, string>): void {
  const headers: Record<string, string> = { ...extraHeaders, ...(reply.headers ?? {}) };
  if (reply.location !== undefined) headers.location = reply.location;
  let payload: Buffer;
  if (reply.bytes !== undefined) {
    payload = reply.bytes;
  } else if (reply.text !== undefined) {
    payload = Buffer.from(reply.text, 'utf8');
  } else if (reply.body !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json; charset=utf-8';
    payload = Buffer.from(JSON.stringify(reply.body), 'utf8');
  } else {
    payload = Buffer.alloc(0);
  }
  headers['content-length'] = String(payload.byteLength);
  res.writeHead(reply.status, headers);
  res.end(payload);
}

export interface StaticHandler {
  (ctx: Ctx): Promise<Reply>;
}

let staticHandler: StaticHandler | null = null;

export function setStaticHandler(handler: StaticHandler): void {
  staticHandler = handler;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function startHttpServer(port: number): void {
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        send(res, { status: 500, body: { error: 'internal', message: 'Something went wrong.' } }, {});
      }
    });
  });
  server.keepAliveTimeout = 65_000;
  server.listen(port, '0.0.0.0');
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') === '' ? '/' : url.pathname.replace(/\/+$/, '');
  const isApi = path === '/api' || path.startsWith('/api/');
  const limit = path === '/api/editor/price-sheets' ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES + 1;
  const { body, tooLarge } = await readBody(req, limit);

  const ctx: Ctx = {
    method,
    path,
    query: url.searchParams,
    params: {},
    body,
    bodyTooLarge: tooLarge,
    headers: req.headers,
    clientAddress: req.socket.remoteAddress ?? 'unknown',
    sessionToken: readCookie(req.headers.cookie, SESSION_COOKIE),
    account: null,
    setCookie: null,
  };

  try {
    if (STATE_CHANGING.has(method)) {
      const origin = req.headers.origin;
      if (typeof origin === 'string' && origin !== 'null') {
        const host = req.headers.host ?? '';
        if (new URL(origin).host !== host) {
          throw new ApiError(403, 'bad_origin', 'That request came from another origin.');
        }
      }
    }

    if (!isApi) {
      if (staticHandler === null) throw new ApiError(404, 'not_found', 'Not found.');
      ctx.account = ctx.sessionToken === null ? null : await accountForSession(ctx.sessionToken);
      const reply = await staticHandler(ctx);
      send(res, reply, cookieHeaders(ctx));
      return;
    }

    const match = matchRoute(method, path);
    if (match === null) throw new ApiError(404, 'not_found', 'That endpoint is not in the programme.');
    ctx.params = match.params;

    if (path !== '/api/health' && !databaseAvailable()) {
      send(res, { status: 503, body: { error: 'unavailable', message: sentences.recordUnavailable } }, {});
      return;
    }

    const reply = await match.route.handler(ctx);
    send(res, reply, cookieHeaders(ctx));
  } catch (error) {
    if (error instanceof ApiError) {
      send(res, { status: error.status, body: error.body(), headers: errorHeaders(error) }, cookieHeaders(ctx));
      return;
    }
    send(
      res,
      { status: 503, body: { error: 'unavailable', message: sentences.recordUnavailable } },
      cookieHeaders(ctx),
    );
  }
}

function errorHeaders(error: ApiError): Record<string, string> {
  const retryAfter = error.extra.retryAfter;
  return typeof retryAfter === 'number' ? { 'retry-after': String(retryAfter) } : {};
}

function cookieHeaders(ctx: Ctx): Record<string, string> {
  return ctx.setCookie === null ? {} : { 'set-cookie': ctx.setCookie };
}

export function requireBodySize(ctx: Ctx): void {
  if (ctx.bodyTooLarge) {
    throw new ApiError(413, 'body_too_large', 'That request body is over the 1,000,000 byte limit.');
  }
}
