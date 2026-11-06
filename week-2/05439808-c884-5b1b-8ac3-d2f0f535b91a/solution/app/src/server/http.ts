// The request pipeline: body limits, the database gate, sessions, CSRF, throttles, operator and clan
// gates, path ids, then the handler. Steps run in the brief's error precedence order.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { now } from './clock';
import { config } from './config';
import { databaseUp, tx } from './db';
import { ApiError, DatabaseUnavailable, fail } from './errors';
import type { AccountRole } from '../shared/catalog';
import { SECURITY_HEADERS, serveStatic } from './static';

const BODY_LIMIT = 65536;
const ID_MAX = 9007199254740991n;
const COOKIE = 'saltreach_session';


export interface Account {
  id: number;
  email: string;
  displayName: string;
  timeZone: string;
  verified: boolean;
  role: AccountRole;
  trophies: number;
  createdAt: number;
}

interface Session {
  id: number;
  csrf: string;
  account: Account | null;
}

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: IncomingMessage['headers'];
  receivedAt: number;
  session: Session | null;
  params: Record<string, number>;
  cookies: string[];
}

export interface SignedInCtx extends Ctx {
  session: Session & { account: Account };
  account: Account;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ThrottleRule {
  key: string;
  limit: number;
  windowMs: number;
}

interface RouteOptions {
  operator?: boolean;
  throttle?: (ctx: Ctx) => ThrottleRule | null;
}

interface Route {
  method: string;
  segments: string[];
  signedIn: boolean;
  options: RouteOptions;
  handler: (ctx: Ctx) => Promise<Reply>;
}

const routes: Route[] = [];

export function publicRoute(method: string, pattern: string, handler: (ctx: Ctx) => Promise<Reply>, options: RouteOptions = {}): void {
  routes.push({ method, segments: pattern.split('/'), signedIn: false, options, handler });
}

export function sessionRoute(method: string, pattern: string, handler: (ctx: SignedInCtx) => Promise<Reply>, options: RouteOptions = {}): void {
  routes.push({ method, segments: pattern.split('/'), signedIn: true, options, handler: (ctx) => handler(ctx as SignedInCtx) });
}

/** A path id is plain decimal digits without a leading zero, from 1 to 2^53 − 1. */
export function parseId(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 1 ? raw : null;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  return BigInt(raw) <= ID_MAX ? Number(raw) : null;
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

function cookieValue(header: string | undefined): string | null {
  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/${config.secureCookie ? '; Secure' : ''}`;
}

interface SessionRow {
  id: number;
  csrf_token: string;
  account_id: number | null;
  signed_in_at: number | null;
  ended_at: number | null;
  email: string | null;
  display_name: string | null;
  time_zone: string | null;
  verified: boolean | null;
  role: AccountRole | null;
  trophies: number | null;
  created_at: number | null;
}

/** The session behind a cookie, or null. A signed-in session past its lifetime is ended here. */
async function loadSession(token: string | null): Promise<Session | null> {
  if (token === null) return null;
  return tx(async (db) => {
    const { rows } = await db.query<SessionRow>(
      `SELECT s.id, s.csrf_token, s.account_id, s.signed_in_at, s.ended_at,
              a.email, a.display_name, a.time_zone, a.verified, a.role, a.trophies, a.created_at
         FROM sessions s LEFT JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = $1`,
      [sha256(token)],
    );
    const row = rows[0];
    if (!row || row.ended_at !== null) return null;
    if (row.account_id === null) return { id: row.id, csrf: row.csrf_token, account: null };
    if ((row.signed_in_at as number) + config.sessionMs <= now()) {
      await db.query('UPDATE sessions SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL', [row.id, now()]);
      return null;
    }
    return {
      id: row.id,
      csrf: row.csrf_token,
      account: {
        id: row.account_id,
        email: row.email as string,
        displayName: row.display_name as string,
        timeZone: row.time_zone as string,
        verified: row.verified as boolean,
        role: row.role as AccountRole,
        trophies: row.trophies as number,
        createdAt: row.created_at as number,
      },
    };
  });
}

/** The CSRF token of the cookie's session row, ended or not; a state change must echo it. */
async function csrfOf(token: string | null): Promise<string | null> {
  if (token === null) return null;
  return tx(async (db) => {
    const { rows } = await db.query<{ csrf_token: string }>('SELECT csrf_token FROM sessions WHERE token_hash = $1', [sha256(token)]);
    return rows[0]?.csrf_token ?? null;
  });
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > BODY_LIMIT) {
    req.resume();
    fail('payload_too_large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) fail('payload_too_large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') fail('unsupported_media_type');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return fail('malformed_json');
  }
}

function matchRoute(method: string, path: string): { route: Route; raw: Record<string, string> } | 'method' | null {
  const parts = path.split('/');
  let pathMatched = false;
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const raw: Record<string, string> = {};
    const ok = route.segments.every((segment, i) => {
      const part = parts[i] as string;
      if (segment.startsWith(':')) {
        raw[segment.slice(1)] = decodeURIComponent(part);
        return part.length > 0;
      }
      return segment === part;
    });
    if (!ok) continue;
    pathMatched = true;
    if (route.method === method) return { route, raw };
  }
  return pathMatched ? 'method' : null;
}

function write(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...reply.headers };
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  res.writeHead(reply.status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

/** The one shared error path: every error reply in the app passes through here. */
export function errorReply(error: unknown): Reply {
  const failure = error instanceof ApiError
    ? error
    : error instanceof DatabaseUnavailable
      ? new ApiError('database_unavailable')
      : new ApiError('internal');
  if (failure.code === 'internal') console.error('unexpected failure', error);
  return { status: failure.status, body: failure.body(), headers: failure.headers };
}

type Gate = (ctx: Ctx) => Promise<void>;
let clanGate: Gate = async () => undefined;
let throttleGate: (rule: ThrottleRule) => Promise<void> = async () => undefined;

/** Wires the gates that need domain modules (kept here so the precedence order lives in one place). */
export function setGates(gates: { clan: Gate; throttle: (rule: ThrottleRule) => Promise<void> }): void {
  clanGate = gates.clan;
  throttleGate = gates.throttle;
}

const STATE_CHANGING = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

async function handleApi(req: IncomingMessage, url: URL): Promise<Reply> {
  const method = req.method ?? 'GET';
  const receivedAt = now();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const body = STATE_CHANGING.has(method) ? await readBody(req) : undefined;
  const found = matchRoute(method, path);
  if (found === null) fail('not_found');
  if (found === 'method') fail('not_found');
  const { route, raw } = found as { route: Route; raw: Record<string, string> };
  const free = path === '/api/health' || path === '/api/status' || path === '/api/events';
  if (!free && !databaseUp()) throw new DatabaseUnavailable();

  const token = cookieValue(req.headers.cookie);
  const session = free ? null : await loadSession(token);
  if (route.signedIn && session?.account == null) fail('unauthenticated');

  if (STATE_CHANGING.has(method)) {
    const origin = req.headers.origin;
    const expected = session?.csrf ?? (await csrfOf(token));
    const sent = req.headers['x-csrf-token'];
    if (typeof origin === 'string' && origin !== config.publicOrigin) fail('csrf_failed');
    if (expected === null || typeof sent !== 'string' || !sameToken(sent, expected)) fail('csrf_failed');
  }

  const ctx: Ctx = { method, path, query: url.searchParams, body, headers: req.headers, receivedAt, session, params: {}, cookies: [] };
  if (route.signedIn) (ctx as SignedInCtx).account = (session as Session & { account: Account }).account;

  const rule = route.options.throttle?.(ctx) ?? null;
  if (rule !== null) await throttleGate(rule);
  if (route.options.operator && ctx.session?.account?.role !== 'operator') fail('forbidden');
  if (path.startsWith('/api/clan/')) await clanGate(ctx);
  for (const [name, value] of Object.entries(raw)) {
    const id = parseId(value);
    if (id === null) fail('not_found');
    ctx.params[name] = id as number;
  }
  const reply = await route.handler(ctx);
  if (ctx.cookies.length > 0) reply.headers = { ...reply.headers, 'Set-Cookie': ctx.cookies.join(', ') };
  return reply;
}

type Streamer = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
let eventStream: Streamer | null = null;

export function setEventStream(streamer: Streamer): void {
  eventStream = streamer;
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://app.invalid');
  if (!url.pathname.startsWith('/api/')) {
    serveStatic(url.pathname, res);
    return;
  }
  if (url.pathname === '/api/events' && req.method === 'GET' && eventStream !== null) {
    try {
      await eventStream(req, res);
    } catch (error) {
      if (!res.headersSent) write(res, errorReply(error));
    }
    return;
  }
  let reply: Reply;
  try {
    reply = await handleApi(req, url);
  } catch (error) {
    reply = errorReply(error);
  }
  write(res, reply);
}

export { loadSession, cookieValue };
