import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../shared/types.js';
import { FILE_BODY_LIMIT, JSON_BODY_LIMIT } from './config.js';
import {
  ApiError,
  forbidden,
  internal,
  notFound,
  payloadTooLarge,
  unsupportedMediaType,
} from './errors.js';
import type { UserRow } from './repo.js';

export const SESSION_COOKIE = 'sd_session';

export class ClientGone extends Error {
  constructor() {
    super('client disconnected');
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  rawBody: Buffer | null;
  user: UserRow | null;
  sessionId: string | null;
  now: Date;
}

export type Handler = (ctx: Ctx) => Promise<void>;

export interface Route {
  method: string;
  pattern: string;
  body?: 'json' | 'raw' | 'none';
  auth?: 'session' | 'ingest' | 'none';
  handler: Handler;
}

interface CompiledRoute extends Route {
  segments: string[];
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

/** Reads a body up to `limit` bytes, refusing an oversize one before reading it in full. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((settle, fail) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > limit) {
      req.resume();
      fail(payloadTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let finished = false;
    const stop = (error: Error): void => {
      if (finished) return;
      finished = true;
      req.destroy();
      fail(error);
    };
    req.on('data', (chunk: Buffer) => {
      if (finished) return;
      total += chunk.byteLength;
      if (total > limit) {
        stop(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('aborted', () => stop(new ClientGone()));
    req.on('error', () => stop(new ClientGone()));
    req.on('end', () => {
      if (finished) return;
      finished = true;
      settle(Buffer.concat(chunks));
    });
  });
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const base = value.split(';')[0]!.trim().toLowerCase();
  return base === 'application/json';
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendRaw(
  res: ServerResponse,
  status: number,
  body: Buffer,
  headers: Record<string, string>,
): void {
  res.writeHead(status, { 'content-length': String(body.byteLength), ...headers });
  res.end(body);
}

export function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, headers);
  res.end();
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body(), error.headers);
}

export function requireRole(ctx: Ctx, roles: Role[]): UserRow {
  const user = ctx.user;
  if (!user) throw internal();
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

export function requireUser(ctx: Ctx): UserRow {
  if (!ctx.user) throw internal();
  return ctx.user;
}

export function jsonObject(ctx: Ctx): Record<string, unknown> {
  const body = ctx.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push({ ...route, segments: route.pattern.split('/').filter((part) => part !== '') });
  }

  /** Matches on the path first, so an unlisted method on a known path answers 404. */
  match(method: string, pathname: string): { route: CompiledRoute; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((part) => part !== '');
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index]!;
        const value = parts[index]!;
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
        else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      if (route.method === method) return { route, params };
    }
    return null;
  }
}

export interface Authenticator {
  session(ctx: Ctx): Promise<void>;
  ingest(ctx: Ctx): Promise<void>;
}

/** Runs a matched route under the published error precedence. */
export async function dispatch(
  router: Router,
  authenticator: Authenticator,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<void> {
  const found = router.match(req.method ?? 'GET', pathname);
  if (!found) throw notFound();
  const { route, params } = found;

  const ctx: Ctx = {
    req,
    res,
    method: req.method ?? 'GET',
    pathname,
    query,
    params,
    body: null,
    rawBody: null,
    user: null,
    sessionId: null,
    now: new Date(),
  };

  const bodyKind = route.body ?? 'none';
  if (bodyKind === 'json') {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE';
    if (hasBody) {
      const raw = await readBody(req, JSON_BODY_LIMIT);
      if (raw.byteLength > 0 && !isJsonContentType(req.headers['content-type'])) {
        throw unsupportedMediaType();
      }
      if (raw.byteLength === 0) ctx.body = {};
      else {
        try {
          ctx.body = JSON.parse(raw.toString('utf8'));
        } catch {
          throw unsupportedMediaType();
        }
      }
    } else {
      ctx.body = {};
    }
  } else if (bodyKind === 'raw') {
    ctx.rawBody = await readBody(req, FILE_BODY_LIMIT);
  }

  const auth = route.auth ?? 'session';
  if (auth === 'session') await authenticator.session(ctx);
  else if (auth === 'ingest') await authenticator.ingest(ctx);

  await route.handler(ctx);
}

export { ApiError, internal };
