import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../db.js';
import { loadAccessView, type AccessView } from '../domain/access.js';
import { serializeContext, type SerializeContext } from '../domain/serialize.js';
import { knownPerson } from '../domain/people.js';
import { SESSION_COOKIE } from '../config.js';
import type { Person } from '../../shared/types.js';
import { ApiError, conflict, notFound, unauthenticated, validation } from './errors.js';
import { checkBody, checkOrigin, parseJson, readCookie, type RawBody } from './boundary.js';

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  raw: RawBody;
  person: Person | null;
  sessionId: string | null;
  view(): Promise<AccessView>;
  serial(): Promise<SerializeContext>;
  /** Drops the cached view so later reads see changes this request has just made. */
  invalidate(): void;
}

export interface AuthedCtx extends Ctx {
  person: Person;
  sessionId: string;
}

export interface Route {
  method: string;
  pattern: string;
  bodyKind?: 'json' | 'part';
  open?: boolean;
  handler: (ctx: Ctx) => Promise<Reply | null>;
}

export const authed = (ctx: Ctx): AuthedCtx => {
  if (ctx.person === null || ctx.sessionId === null) throw unauthenticated();
  return ctx as AuthedCtx;
};

const matchPattern = (
  pattern: string,
  path: string,
): Record<string, string> | null => {
  const wanted = pattern.split('/');
  const given = path.split('/');
  if (wanted.length !== given.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < wanted.length; index += 1) {
    const slot = wanted[index] ?? '';
    const value = given[index] ?? '';
    if (slot.startsWith(':')) {
      if (value === '') return null;
      params[slot.slice(1)] = decodeURIComponent(value);
    } else if (slot !== value) {
      return null;
    }
  }
  return params;
};

export const findRoute = (
  routes: Route[],
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null => {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, path);
    if (params !== null) return { route, params };
  }
  return null;
};

export const buildContext = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  params: Record<string, string>,
  route: Route,
): Promise<Ctx> => {
  const raw = await checkBody(req, route.bodyKind ?? 'json');
  checkOrigin(req);

  const token = readCookie(req, SESSION_COOKIE);
  let person: Person | null = null;
  let sessionId: string | null = null;
  if (token !== null) {
    const { rows } = await db.query<{ person_id: string }>(
      'SELECT person_id FROM sessions WHERE id = $1',
      [token],
    );
    const row = rows[0];
    if (row !== undefined) {
      person = await knownPerson(row.person_id);
      if (person !== null) sessionId = token;
    }
  }
  if (route.open !== true && person === null) throw unauthenticated();

  let cachedView: AccessView | null = null;
  let cachedSerial: SerializeContext | null = null;
  const loadView = async (): Promise<AccessView> => {
    if (person === null) throw unauthenticated();
    cachedView ??= await loadAccessView(person);
    return cachedView;
  };
  return {
    req,
    res,
    url,
    params,
    raw,
    body: route.bodyKind === 'part' ? {} : parseJson(raw),
    person,
    sessionId,
    view: loadView,
    async serial() {
      cachedSerial ??= await serializeContext(await loadView());
      return cachedSerial;
    },
    invalidate() {
      cachedView = null;
      cachedSerial = null;
    },
  };
};

const hashBody = (raw: RawBody): string =>
  createHash('sha256').update(raw.bytes).digest('hex');

/**
 * A repeated key from the same person with the same body returns the stored answer.
 * The same key with a different body is refused.
 */
export const withIdempotency = async (
  ctx: AuthedCtx,
  scope: string,
  run: () => Promise<Reply>,
): Promise<Reply> => {
  const header = ctx.req.headers['idempotency-key'];
  const key = typeof header === 'string' ? header : null;
  if (key === null) return run();
  if (key.length < 1 || key.length > 100) {
    throw validation({ 'Idempotency-Key': 'Keys are 1 to 100 characters.' });
  }
  const digest = hashBody(ctx.raw);
  const { rows } = await db.query<{
    scope: string;
    body_hash: string;
    status: number;
    response: unknown;
  }>('SELECT scope, body_hash, status, response FROM idempotency_records WHERE person_id = $1 AND key = $2', [
    ctx.person.id,
    key,
  ]);
  const stored = rows[0];
  if (stored !== undefined) {
    if (stored.scope !== scope || stored.body_hash !== digest) {
      throw conflict('idempotency_key_reused');
    }
    return {
      status: stored.status,
      body: stored.response,
      headers: { 'Idempotent-Replayed': 'true' },
    };
  }
  const reply = await run();
  await db.query(
    `INSERT INTO idempotency_records (person_id, key, scope, body_hash, status, response)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (person_id, key) DO NOTHING`,
    [ctx.person.id, key, scope, digest, reply.status, JSON.stringify(reply.body ?? null)],
  );
  return reply;
};

export const sendJson = (res: ServerResponse, reply: Reply): void => {
  const payload = reply.body === undefined ? '' : JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(payload),
    ...(reply.headers ?? {}),
  });
  res.end(payload);
};

export const sendError = (res: ServerResponse, error: unknown): void => {
  if (error instanceof ApiError) {
    sendJson(res, { status: error.status, body: error.body() });
    return;
  }
  if (error instanceof SyntaxError) {
    sendJson(res, { status: 422, body: { error: 'validation', fields: { body: 'Send JSON.' } } });
    return;
  }
  console.error('request failed', error);
  sendJson(res, { status: 500, body: { error: 'internal' } });
};

export const requireFound = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw notFound();
  return value;
};
