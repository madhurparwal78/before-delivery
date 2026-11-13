import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ApiError, crossOrigin, tooLargeBody } from './errors';
import { RawNode, parseRawJson, rawToValue } from '../shared/rawjson';
import { BODY_LIMIT } from './config';

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
};

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  cookies: Record<string, string>;
  bodyText: string;
  raw: RawNode | null;
  body: Record<string, unknown>;
  user: SessionUser | null;
  visitorId: string;
  aborted: () => boolean;
  signal: AbortSignal;
};

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name.length > 0) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  maxAgeSeconds: number,
): void {
  const existing = res.getHeader('Set-Cookie');
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

export function clearCookie(res: ServerResponse, name: string): void {
  const existing = res.getHeader('Set-Cookie');
  const cookie = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

export function sendJson(
  ctx: Ctx,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (ctx.res.writableEnded) return;
  const text = JSON.stringify(body);
  ctx.res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  ctx.res.end(text);
}

export function sendBytes(
  ctx: Ctx,
  status: number,
  bytes: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  if (ctx.res.writableEnded) return;
  ctx.res.writeHead(status, {
    'content-type': contentType,
    'content-length': bytes.length,
    ...headers,
  });
  ctx.res.end(bytes);
}

export function sendHtml(ctx: Ctx, status: number, html: string): void {
  const bytes = Buffer.from(html, 'utf8');
  sendBytes(ctx, status, bytes, 'text/html; charset=utf-8', { 'cache-control': 'no-store' });
}

export function redirect(ctx: Ctx, location: string, status = 303): void {
  if (ctx.res.writableEnded) return;
  ctx.res.writeHead(status, { location, 'cache-control': 'no-store' });
  ctx.res.end();
}

export function sendError(ctx: Ctx, error: ApiError): void {
  sendJson(ctx, error.status, error.body, error.headers);
}

/** A state-changing request whose Origin names another origin is refused. */
export function checkOrigin(req: IncomingMessage, method: string): void {
  if (method === 'GET' || method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = req.headers.host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw crossOrigin();
  }
  if (originHost !== host) throw crossOrigin();
}

export async function readBody(req: IncomingMessage, limit = BODY_LIMIT): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > limit) throw tooLargeBody(limit);
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function parseBody(text: string): { raw: RawNode | null; body: Record<string, unknown> } {
  if (text.trim().length === 0) return { raw: null, body: {} };
  try {
    const raw = parseRawJson(text);
    const value = rawToValue(raw);
    if (raw.kind !== 'object') return { raw, body: {} };
    return { raw, body: value as Record<string, unknown> };
  } catch {
    return { raw: null, body: {} };
  }
}

export function newId(): string {
  return randomUUID();
}
