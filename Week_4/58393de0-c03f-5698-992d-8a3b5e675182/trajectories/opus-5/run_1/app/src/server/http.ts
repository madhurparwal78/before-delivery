import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, forbidden, tooLarge } from './errors.js';
import { publicOrigin } from './config.js';

export const SESSION_COOKIE = 'qy_session';

export const JSON_LIMIT = 1_000_000;
export const PROJECT_LIMIT = 2_000_000;
export const EXPORT_LIMIT = 20_000_000;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  cookies: Record<string, string>;
  clientIp: string;
}

export const makeContext = (req: IncomingMessage, res: ServerResponse): RequestContext => ({
  req,
  res,
  url: new URL(req.url ?? '/', publicOrigin),
  method: req.method ?? 'GET',
  cookies: parseCookies(req.headers.cookie),
  clientIp: clientIpOf(req),
});

const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
};

const clientIpOf = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';

/** Same-origin only: a state-changing request from another origin is refused. */
export const checkOrigin = (ctx: RequestContext): void => {
  if (ctx.method === 'GET' || ctx.method === 'HEAD' || ctx.method === 'OPTIONS') return;
  const origin = ctx.req.headers.origin;
  if (origin !== undefined && origin !== 'null' && origin !== publicOrigin) throw forbidden();
};

/** Body limits are inclusive; an oversized body is drained so the 413 still reaches the caller. */
export const readBody = async (ctx: RequestContext, limit: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooBig = false;
  for await (const chunk of ctx.req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      tooBig = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooBig) throw tooLarge();
  return Buffer.concat(chunks);
};

export const parseJsonBody = (ctx: RequestContext, body: Buffer): Record<string, unknown> => {
  const type = (ctx.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (body.length === 0) {
    if (type !== '' && type !== 'application/json') throw new ApiError(415, 'unsupported_media');
    return {};
  }
  if (type !== 'application/json') throw new ApiError(415, 'unsupported_media');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new ApiError(422, 'validation', { fields: {} });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(422, 'validation', { fields: {} });
  }
  return parsed as Record<string, unknown>;
};

export const sendJson = (ctx: RequestContext, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  ctx.res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  ctx.res.end(payload);
};

export const sendEmpty = (ctx: RequestContext, status: number, headers: Record<string, string> = {}): void => {
  ctx.res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  ctx.res.end();
};

export const sendError = (ctx: RequestContext, error: ApiError): void => {
  const headers: Record<string, string> = {};
  if (error.body.retryAfterSeconds !== undefined) {
    headers['retry-after'] = String(error.body.retryAfterSeconds);
  }
  sendJson(ctx, error.status, error.body, headers);
};

export const setSessionCookie = (ctx: RequestContext, token: string): void => {
  appendCookie(ctx, `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
};

export const clearSessionCookie = (ctx: RequestContext): void => {
  appendCookie(ctx, `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
};

const appendCookie = (ctx: RequestContext, value: string): void => {
  const existing = ctx.res.getHeader('set-cookie');
  const list = Array.isArray(existing) ? existing : typeof existing === 'string' ? [existing] : [];
  ctx.res.setHeader('set-cookie', [...list, value]);
};
