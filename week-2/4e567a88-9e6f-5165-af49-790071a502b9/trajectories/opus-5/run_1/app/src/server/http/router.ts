import { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BODY_LIMIT, UPLOAD_LIMIT } from '../config';
import { ApiError, fail } from '../errors';
import { Caller, JsonObject, JsonValue } from '../types';
import { memberByApiKey, memberBySession } from '../store/people';

export type BodyMode = 'none' | 'json' | 'raw';

export interface PublicCtx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: JsonObject;
  raw: Buffer;
  caller: Caller | null;
  sessionId: string | null;
}

export interface Ctx extends PublicCtx {
  caller: Caller;
}

export interface Reply {
  status: number;
  headers?: Record<string, string>;
  json?: JsonValue;
  text?: string;
  contentType?: string;
}

export interface Route {
  method: string;
  pattern: string;
  auth: 'none' | 'signedIn';
  body: BodyMode;
  handler: (ctx: PublicCtx) => Promise<Reply>;
}

export const ok = (json: JsonValue): Reply => ({ status: 200, json });
export const created = (json: JsonValue): Reply => ({ status: 201, json });
export const accepted = (json: JsonValue): Reply => ({ status: 202, json });
export const noContent = (): Reply => ({ status: 204 });
export const csv = (text: string, filename: string): Reply => ({
  status: 200,
  text,
  contentType: 'text/csv; charset=utf-8',
  headers: { 'content-disposition': `attachment; filename="${filename}"` },
});

const PARAM = /^:(.+)$/;

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]!;
    const actual = pathParts[index]!;
    const param = PARAM.exec(expected);
    if (param) {
      const name = param[1]!;
      params[name] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw fail.payloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  return value.split(';')[0]!.trim().toLowerCase() === 'application/json';
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export class Router {
  private readonly routes: Route[] = [];

  /** A route every signed-in caller reaches; role checks live in the handler. */
  add(method: string, pattern: string, body: BodyMode, handler: (ctx: Ctx) => Promise<Reply>): void {
    this.routes.push({
      method,
      pattern,
      auth: 'signedIn',
      body,
      handler: (ctx) => handler(ctx as Ctx),
    });
  }

  addPublic(method: string, pattern: string, body: BodyMode, handler: (ctx: PublicCtx) => Promise<Reply>): void {
    this.routes.push({ method, pattern, auth: 'none', body, handler });
  }

  find(method: string, path: string): { route: Route; params: Record<string, string> } | 'unknown' {
    for (const route of this.routes) {
      const params = matchPath(route.pattern, path);
      if (params && route.method === method) return { route, params };
    }
    return 'unknown';
  }

  async dispatch(req: IncomingMessage, path: string, query: URLSearchParams): Promise<Reply> {
    const method = req.method ?? 'GET';
    const found = this.find(method, path);
    if (found === 'unknown') throw fail.notFound();
    const { route, params } = found;

    let raw = Buffer.alloc(0);
    let body: JsonObject = {};
    if (route.body === 'json') {
      const contentType = req.headers['content-type'];
      raw = await readBody(req, JSON_BODY_LIMIT);
      if (raw.length > 0 && !isJsonContentType(contentType)) throw fail.unsupportedMediaType();
      if (raw.length > 0) {
        let parsed: JsonValue;
        try {
          parsed = JSON.parse(raw.toString('utf8')) as JsonValue;
        } catch {
          throw fail.malformedJson();
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail.malformedJson();
        body = parsed;
      }
    } else if (route.body === 'raw') {
      const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      raw = await readBody(req, UPLOAD_LIMIT);
      if (!IMAGE_TYPES.includes(contentType as (typeof IMAGE_TYPES)[number])) {
        throw fail.unsupportedMediaType('Use a PNG, JPEG or WebP image.');
      }
    } else {
      req.resume();
    }

    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies['dispatch_session'] ?? null;
    let caller: Caller | null = null;
    const authorization = req.headers.authorization;
    if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
      const member = await memberByApiKey(authorization.slice(7).trim());
      if (member) caller = { member, context: 'api' };
    } else if (sessionId) {
      const member = await memberBySession(sessionId);
      if (member) caller = { member, context: 'playground' };
    }

    if (route.auth === 'signedIn' && !caller) throw fail.unauthenticated();

    const isWrite = method === 'POST' || method === 'PUT' || method === 'DELETE';
    if (isWrite && caller?.context === 'playground') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host ?? ''}` && origin !== `https://${req.headers.host ?? ''}`) {
        throw fail.crossOrigin();
      }
    }

    const ctx: PublicCtx = {
      method,
      path,
      params,
      query,
      headers: req.headers,
      body,
      raw,
      caller,
      sessionId,
    };
    return route.handler(ctx);
  }
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  let payload: Buffer;
  if (reply.json !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8';
    payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
  } else if (reply.text !== undefined) {
    headers['content-type'] = reply.contentType ?? 'text/plain; charset=utf-8';
    payload = Buffer.from(reply.text, 'utf8');
  } else {
    payload = Buffer.alloc(0);
  }
  if (payload.length > 0) headers['content-length'] = String(payload.length);
  headers['x-content-type-options'] = 'nosniff';
  res.writeHead(reply.status, headers);
  res.end(payload.length > 0 ? payload : undefined);
}

export function sendError(res: ServerResponse, error: unknown): void {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(500, 'internal_error', 'Something went wrong handling that request.');
  if (!(error instanceof ApiError)) {
    console.error('unhandled request error', error);
  }
  send(res, { status: apiError.status, json: apiError.body() });
}
