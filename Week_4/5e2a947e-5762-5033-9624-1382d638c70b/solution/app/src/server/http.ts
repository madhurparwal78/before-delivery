import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, STAGES, type Stage } from '../shared/errors.ts';
import { LIMITS } from '../shared/rules.ts';

export interface Principal {
  /** Stable id: a user id, or `guest:<id>` for a guest. */
  id: string;
  /** Username, or the guest's display name. */
  name: string;
  guest: boolean;
  /** The map a guest is bound to. */
  guestMap: string | null;
  guestRole: 'editor' | 'commenter' | 'viewer' | null;
  /** When the session ends, in server milliseconds; null for guests. */
  expiresAt: number | null;
}

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: Uint8Array;
  headers?: Record<string, string>;
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({ status, body, headers: headers ?? {} });
export const empty = (): Reply => ({ status: 204 });

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  cookies: Record<string, string>;
  req: IncomingMessage;
  /** Parsed JSON body, available after the body_size stage when the route declared `json`. */
  body: unknown;
  /** Raw body bytes, available after the body_size stage when the route declared `raw`. */
  bytes: Uint8Array;
  principal: Principal | null;
  /** Scratch space routes use to pass resolved resources between their stages. */
  scope: Record<string, unknown>;
}

export type StageFn = (ctx: Ctx) => void | Promise<void>;

export interface RouteSpec {
  /** `json` reads a JSON body up to 1,000,000 bytes; a number reads raw bytes up to that many. */
  body?: 'json' | { raw: () => number; message?: (limit: number) => string };
  stages: Partial<Record<Stage, StageFn>>;
  handle: (ctx: Ctx) => Promise<Reply>;
}

interface Route {
  method: string;
  names: string[];
  pattern: RegExp;
  spec: RouteSpec;
}

const routes: Route[] = [];

export function route(method: string, template: string, spec: RouteSpec): void {
  const names: string[] = [];
  const source = template.replace(/:([a-z_]+)/g, (_all, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  routes.push({ method, names, pattern: new RegExp(`^${source}$`), spec });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

async function readBody(req: IncomingMessage, limit: number, message = 'The request body is too large.'): Promise<Uint8Array> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new ApiError('too_large', message);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > limit) throw new ApiError('too_large', message);
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

/** A path segment decoded; a malformed escape is kept as written so the lookup simply finds nothing. */
export function decodeSegment(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'UPGRADE']);

function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Refuse requests that change state and come from another origin. */
export function assertSameOrigin(method: string, origin: string | undefined, host: string | undefined): void {
  if (STATE_CHANGING.has(method) && origin !== undefined && !sameOrigin(origin, host)) {
    throw new ApiError('forbidden', 'Requests from another origin are not allowed.');
  }
}

/** The status line, headers and body of a reply as one HTTP/1.1 message, for answers written to a raw socket. */
export function serialize(reply: Reply): string {
  const body = reply.body === undefined ? '' : JSON.stringify(reply.body);
  const headers = { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(body)), connection: 'close', ...(reply.headers ?? {}) };
  return `HTTP/1.1 ${reply.status} ${reply.status}\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${body}`;
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { 'cache-control': 'no-store', ...(reply.headers ?? {}) };
  if (reply.bytes) {
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  res.writeHead(reply.status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(reply.body));
}

export function sendError(res: ServerResponse, error: ApiError): void {
  send(res, { status: error.status, body: error.body(), headers: error.headers ?? {} });
}

/** Run a route's stages in the one published precedence order, then its handler. */
export async function execute(spec: RouteSpec, ctx: Ctx, bodyAlreadyRead = false): Promise<Reply> {
  for (const stage of STAGES) {
    if (stage === 'body_size') {
      if (bodyAlreadyRead) continue;
      if (spec.body === 'json') {
        const bytes = await readBody(ctx.req, LIMITS.json_bytes);
        if (bytes.length > 0) {
          try {
            ctx.body = JSON.parse(Buffer.from(bytes).toString('utf8'));
          } catch {
            ctx.body = undefined;
          }
        }
      } else if (spec.body) {
        const limit = spec.body.raw();
        ctx.bytes = await readBody(ctx.req, limit, spec.body.message?.(limit));
      }
      continue;
    }
    if (stage === 'authorize') assertSameOrigin(ctx.method, ctx.headers.origin, ctx.headers.host);
    await spec.stages[stage]?.(ctx);
  }
  return spec.handle(ctx);
}

/** Match a request to a route and answer it. Returns false when no route matches. */
export async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET';
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const found = candidate.pattern.exec(url.pathname);
    if (!found) continue;
    const params: Record<string, string> = {};
    candidate.names.forEach((name, at) => {
      params[name] = decodeSegment(found[at + 1] ?? '');
    });
    const ctx: Ctx = {
      method,
      path: url.pathname,
      query: url.searchParams,
      params,
      headers: req.headers,
      cookies: parseCookies(req.headers.cookie),
      req,
      body: undefined,
      bytes: new Uint8Array(),
      principal: null,
      scope: {},
    };
    try {
      send(res, await execute(candidate.spec, ctx));
    } catch (error) {
      if (error instanceof ApiError) sendError(res, error);
      else {
        process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
        sendError(res, new ApiError('storage_unavailable', 'Something went wrong. Try again in a moment.'));
      }
    }
    return true;
  }
  return false;
}

/** The JSON body as an object, or a 422. */
export function bodyObject(ctx: Ctx): Record<string, unknown> {
  const body = ctx.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ApiError('invalid', 'The request body must be a JSON object.');
  return body as Record<string, unknown>;
}
