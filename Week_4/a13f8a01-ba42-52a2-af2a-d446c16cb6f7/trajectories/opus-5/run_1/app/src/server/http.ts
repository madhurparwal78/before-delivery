import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseCookies, SESSION_COOKIE, userForSession, type UserRow } from './auth';
import { config } from './config';
import { ApiError, apiError } from './errors';

export interface Ctx {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  params: Record<string, string>;
  user: UserRow | null;
  sessionId: string | null;
  body: unknown;
  rawBody: Buffer;
  idempotencyKey: string | undefined;
}

export interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
  cookie?: string;
}

/** Returned by handlers that have written the response themselves. */
export const HANDLED: Reply = { status: 0 };

export interface Route {
  method: string;
  pattern: string;
  handler: (ctx: Ctx) => Promise<Reply>;
}

interface CompiledRoute extends Route {
  segments: string[];
}

const compile = (route: Route): CompiledRoute => ({
  ...route,
  segments: route.pattern.split('/').filter((segment) => segment.length > 0),
});

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(method: string, pattern: string, handler: (ctx: Ctx) => Promise<Reply>): void {
    this.routes.push(compile({ method, pattern, handler }));
  }

  match(method: string, pathname: string): { route: CompiledRoute; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((segment) => segment.length > 0);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let index = 0; index < parts.length; index += 1) {
        const expected = route.segments[index]!;
        const actual = parts[index]!;
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method) return { route, params };
    }
    if (pathMatched) throw apiError('not_found');
    return null;
  }
}

export const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > config.bodyLimitBytes) throw apiError('body_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const APP_ORIGIN = new URL(config.appPublicUrl).origin;

/** Cross-site writes that carry the session cookie are refused before the sign-in check. */
export const checkOrigin = (request: IncomingMessage, hasSession: boolean): void => {
  const method = request.method ?? 'GET';
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
  if (!hasSession) return;
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (origin !== APP_ORIGIN) {
    throw apiError('forbidden', { message: 'Cross-site request refused.' });
  }
};

export const buildContext = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  params: Record<string, string>,
): Promise<Ctx> => {
  const cookies = parseCookies(request.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE] ?? null;
  const rawBody = await readBody(request);
  checkOrigin(request, sessionId !== null);
  const user = await userForSession(sessionId);
  let body: unknown = null;
  if (rawBody.byteLength > 0) {
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw apiError('validation', { fields: { body: 'Send a JSON body.' } });
    }
  }
  const idempotency = request.headers['idempotency-key'];
  return {
    request,
    response,
    url,
    params,
    user,
    sessionId,
    body,
    rawBody,
    idempotencyKey: Array.isArray(idempotency) ? idempotency[0] : idempotency,
  };
};

export const sendReply = (response: ServerResponse, reply: Reply): void => {
  if (reply.status === 0) return;
  const headers: Record<string, string | string[]> = { ...reply.headers };
  if (reply.cookie) headers['set-cookie'] = reply.cookie;
  if (reply.raw !== undefined) {
    headers['content-type'] = reply.contentType ?? 'text/plain; charset=utf-8';
    const payload = typeof reply.raw === 'string' ? Buffer.from(reply.raw, 'utf8') : reply.raw;
    headers['content-length'] = String(payload.byteLength);
    response.writeHead(reply.status, headers);
    response.end(payload);
    return;
  }
  if (reply.body === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body), 'utf8');
  headers['content-type'] = 'application/json; charset=utf-8';
  headers['content-length'] = String(payload.byteLength);
  response.writeHead(reply.status, headers);
  response.end(payload);
};

export const errorReply = (error: unknown): Reply => {
  if (error instanceof ApiError) return { status: error.status, body: error.body };
  process.stderr.write(`${String(error)}\n`);
  return { status: 500, body: { error: 'validation', message: 'That request could not be handled.' } };
};

export const json = (status: number, body: unknown): Reply => ({ status, body });
export const noContent = (): Reply => ({ status: 204 });
