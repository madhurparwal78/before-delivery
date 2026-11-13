import type { IncomingMessage, ServerResponse } from 'node:http';
import { config, publicOrigin } from './config.js';
import { ApiError, errors } from './errors.js';
import { resolveLocale } from './locale.js';
import { accountForAuthToken, type AccountRow } from './accounts.js';
import { JSON_BODY_MAX_BYTES } from '../shared/constants.js';
import type { Locale } from '../shared/i18n/index.js';

export const SESSION_COOKIE = 'lw_session';
const LOCALE_COOKIE = 'lw_locale';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  cookies: Record<string, string>;
  locale: Locale;
  account: AccountRow | null;
  setCookies: string[];
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== '') jar[name] = decodeURIComponent(value);
  }
  return jar;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

export async function buildContext(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Ctx> {
  const cookies = parseCookies(req.headers.cookie);
  const url = new URL(req.url ?? '/', config.publicUrl);
  const token = cookies[SESSION_COOKIE];
  const account = token === undefined ? null : await accountForAuthToken(token);
  const locale = resolveLocale({
    accountLocale: account?.locale ?? null,
    cookieLocale: cookies[LOCALE_COOKIE] ?? null,
    acceptLanguage: req.headers['accept-language'],
  });
  return {
    req,
    res,
    url,
    method: req.method ?? 'GET',
    params: {},
    cookies,
    locale,
    account,
    setCookies: [],
  };
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function assertSameOrigin(req: IncomingMessage): void {
  const method = req.method ?? 'GET';
  if (!STATE_CHANGING.has(method)) return;
  const origin = req.headers.origin;
  if (origin === undefined) return;
  if (origin !== publicOrigin) throw errors.crossOrigin();
}

export function requireAccount(ctx: Ctx): AccountRow {
  if (ctx.account === null) throw errors.unauthenticated();
  return ctx.account;
}

export function requireVerified(ctx: Ctx): AccountRow {
  const account = requireAccount(ctx);
  if (!account.email_verified) throw errors.emailUnverified();
  return account;
}

/**
 * A body over the limit is drained, never kept, and refused at its end: leaving the loop early
 * would destroy the request and strand the next request on a kept-alive connection.
 */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size <= limit) chunks.push(buffer);
  }
  if (size > limit) throw errors.bodyTooLarge();
  return Buffer.concat(chunks);
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req, JSON_BODY_MAX_BYTES);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw errors.invalidFields({});
  }
}

export interface Reply {
  status: number;
  body?: unknown;
  raw?: { contentType: string; body: Buffer };
  headers?: Record<string, string>;
  cookies?: string[];
}

export function send(ctx: Ctx, reply: Reply): void {
  const headers: Record<string, string | string[]> = {
    'X-Content-Type-Options': 'nosniff',
    ...reply.headers,
  };
  const cookies = [...ctx.setCookies, ...(reply.cookies ?? [])];
  if (cookies.length > 0) headers['Set-Cookie'] = cookies;
  if (reply.raw !== undefined) {
    headers['Content-Type'] = reply.raw.contentType;
    headers['Content-Length'] = String(reply.raw.body.length);
    ctx.res.writeHead(reply.status, headers);
    ctx.res.end(reply.raw.body);
    return;
  }
  if (reply.body === undefined) {
    ctx.res.writeHead(reply.status, headers);
    ctx.res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body), 'utf8');
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = String(payload.length);
  ctx.res.writeHead(reply.status, headers);
  ctx.res.end(payload);
}

export function sendApiError(ctx: Ctx, error: ApiError): void {
  send(ctx, {
    status: error.status,
    body: error.body(ctx.locale),
    headers: error.headers,
  });
}

export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : errors.internal();
}
