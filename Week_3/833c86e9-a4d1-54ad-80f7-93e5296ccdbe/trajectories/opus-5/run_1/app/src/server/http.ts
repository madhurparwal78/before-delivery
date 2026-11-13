import { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { Context, SessionUser, ensureVisitor, loadUser, storedPreferences } from './auth';
import { ApiError } from './errors';
import { one } from './db';
import { Cur, Lang } from '../shared/types';

export const JSON_LIMIT = 65536;

export interface Call {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  body: Buffer;
  json: Record<string, unknown>;
  ctx: Context;
  setCookies: string[];
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, maxAgeSeconds = 60 * 60 * 24 * 365): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) return 'too_large';
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  cookies: string[] = [],
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers,
    ...(cookies.length > 0 ? { 'set-cookie': cookies } : {}),
  });
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType: string,
  headers: Record<string, string> = {},
  cookies: string[] = [],
): void {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': payload.length,
    ...headers,
    ...(cookies.length > 0 ? { 'set-cookie': cookies } : {}),
  });
  res.end(payload);
}

export function errorResponse(res: ServerResponse, err: unknown, cookies: string[] = []): void {
  if (err instanceof ApiError) {
    sendJson(res, err.status, err.body, {}, cookies);
    return;
  }
  sendJson(res, 500, { error: 'server_error' }, {}, cookies);
}

export async function resolveContext(
  req: IncomingMessage,
  options: { createVisitor: boolean },
): Promise<{ ctx: Context; cookies: string[] }> {
  const cookies = parseCookies(req.headers.cookie);
  const cookiesOut: string[] = [];
  let sessionId: string | null = cookies.kip_session ?? null;
  let user: SessionUser | null = null;
  if (sessionId) {
    const row = await one<{ username: string }>('select username from sessions where id = $1', [sessionId]);
    if (row) user = await loadUser(row.username);
    else sessionId = null;
  }
  let visitorId: string | null = cookies.kip_visitor ?? null;
  if (options.createVisitor) {
    const fresh = await ensureVisitor(visitorId);
    if (fresh !== visitorId) cookiesOut.push(cookie('kip_visitor', fresh));
    visitorId = fresh;
  } else if (visitorId) {
    const row = await one('select id from visitors where id = $1', [visitorId]);
    if (!row) visitorId = null;
  }
  const prefs = await storedPreferences({ sessionId, visitorId });
  const ctx: Context = {
    visitorId,
    sessionId,
    user,
    lang: (prefs.lang as Lang) ?? 'en',
    cur: (prefs.cur as Cur) ?? 'EUR',
  };
  return { ctx, cookies: cookiesOut };
}

const counters = new Map<string, { minute: number; count: number }>();

/** Rate limits, counted per minute on real time. */
export function rateLimit(key: string, limit: number): { ok: boolean; retryAfter: number } {
  const minute = Math.floor(Date.now() / 60000);
  const entry = counters.get(key);
  if (!entry || entry.minute !== minute) {
    counters.set(key, { minute, count: 1 });
    return { ok: true, retryAfter: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((minute + 1) * 60000 - Date.now()) / 1000);
    return { ok: false, retryAfter: Math.ceil(retryAfter) };
  }
  return { ok: true, retryAfter: 0 };
}

export function bodyHash(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}
