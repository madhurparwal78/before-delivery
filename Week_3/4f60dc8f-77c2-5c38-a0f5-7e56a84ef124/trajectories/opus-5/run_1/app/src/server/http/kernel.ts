import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, errorBody, fail } from './app-error.js';

export const JSON_BODY_LIMIT = 65_536;

export type Ctx = {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
};

export type Handler = (ctx: Ctx) => Promise<void>;

export type Route = { method: string; segments: string[]; handler: Handler };

export const route = (method: string, pattern: string, handler: Handler): Route => ({
  method,
  segments: pattern.split('/').filter((segment) => segment !== ''),
  handler,
});

export const matchRoute = (
  routes: readonly Route[],
  method: string,
  pathname: string,
): { handler: Handler; params: Record<string, string> } | null => {
  const parts = pathname.split('/').filter((segment) => segment !== '');
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const pattern = candidate.segments[index];
      if (pattern.startsWith(':')) {
        params[pattern.slice(1)] = decodeURIComponent(parts[index]);
        continue;
      }
      if (pattern !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler: candidate.handler, params };
  }
  return null;
};

export const requestOrigin = (ctx: Ctx): string => {
  const forwardedProto = ctx.request.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : 'http';
  const host = ctx.request.headers.host ?? '';
  return `${proto}://${host}`;
};

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const checkCrossOrigin = (ctx: Ctx): void => {
  if (!STATE_CHANGING.has(ctx.method)) return;
  const origin = ctx.request.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = ctx.request.headers.host ?? '';
  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    fail('cross_origin');
    return;
  }
  if (candidate.host !== host) fail('cross_origin');
};

export const readBodyBuffer = async (
  ctx: Ctx,
  limit: number,
  code: 'payload_too_large',
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of ctx.request) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) {
      ctx.request.pause();
      fail(code);
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
};

/**
 * An unread request body cannot be left half-arriving on a reused connection, so the
 * response closes it and the socket is dropped once the reply is flushed.
 */
export const closeAfterResponse = (ctx: Ctx): void => {
  if (ctx.request.complete) return;
  ctx.response.setHeader('Connection', 'close');
  ctx.response.once('finish', () => {
    ctx.request.destroy();
  });
};

export const readJson = async (ctx: Ctx): Promise<Record<string, unknown>> => {
  const body = await readBodyBuffer(ctx, JSON_BODY_LIMIT, 'payload_too_large');
  if (body.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return {};
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};

export const sendJson = (
  ctx: Ctx,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  ctx.response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.byteLength,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  ctx.response.end(payload);
};

export const sendHtml = (
  ctx: Ctx,
  status: number,
  html: string,
  headers: Record<string, string> = {},
): void => {
  const payload = Buffer.from(html, 'utf8');
  ctx.response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.byteLength,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  ctx.response.end(payload);
};

export const sendNoContent = (ctx: Ctx, headers: Record<string, string> = {}): void => {
  ctx.response.writeHead(204, headers);
  ctx.response.end();
};

export const sendError = (ctx: Ctx, error: AppError): void => {
  sendJson(ctx, error.status, errorBody(error), error.headers ?? {});
};

export const readCookies = (ctx: Ctx): Record<string, string> => {
  const header = ctx.request.headers.cookie;
  if (header === undefined) return {};
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
};

export const setCookie = (name: string, value: string): string =>
  `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/`;

export const clearCookie = (name: string): string =>
  `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export const appendSetCookie = (ctx: Ctx, cookie: string): void => {
  const existing = ctx.response.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing : existing === undefined ? [] : [String(existing)];
  ctx.response.setHeader('Set-Cookie', [...list, cookie]);
};

export const idempotencyKey = (ctx: Ctx): string => {
  const header = ctx.request.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.length < 1 || value.length > 200) fail('idempotency_key_required');
  return value as string;
};
