import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { User, readCookie, userForToken } from './auth';
import { nowMs } from './clock';
import { bodyLimits, config } from './config';
import { db } from './db';
import { ApiError, errors } from './errors';
import { StorageUnavailable, storageForcedDown } from './storage';
import { storageOutageText } from './errors';

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  rawBody: string;
  user: User;
  headers: Record<string, string | undefined>;
};

export type Reply = { status: number; body: unknown; headers?: Record<string, string> } | 'handled';

type RouteOptions = {
  auth?: boolean;
  grading?: boolean;
  limit?: keyof typeof bodyLimits;
  write?: boolean;
  idempotent?: boolean;
};

type Route = {
  method: string;
  parts: string[];
  names: (string | null)[];
  handler: (ctx: Ctx) => Promise<Reply>;
  options: RouteOptions;
};

const routes: Route[] = [];

export function route(
  method: string,
  pattern: string,
  handler: (ctx: Ctx) => Promise<Reply>,
  options: RouteOptions = {},
): void {
  const parts = pattern.split('/').filter((part) => part.length > 0);
  routes.push({
    method,
    parts,
    names: parts.map((part) => (part.startsWith(':') ? part.slice(1) : null)),
    handler,
    options,
  });
}

function match(method: string, pathname: string): { route: Route; params: Record<string, string> } | 'method' | null {
  const segments = pathname.split('/').filter((part) => part.length > 0);
  let pathMatched = false;
  let best: { route: Route; params: Record<string, string>; literals: number } | null = null;
  for (const candidate of routes) {
    if (candidate.parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    let literals = 0;
    for (let index = 0; index < segments.length; index += 1) {
      const name = candidate.names[index];
      if (name !== null) {
        params[name] = decodeURIComponent(segments[index]);
        continue;
      }
      if (candidate.parts[index] !== segments[index]) {
        ok = false;
        break;
      }
      literals += 1;
    }
    if (!ok) continue;
    pathMatched = true;
    if (candidate.method !== method) continue;
    if (best === null || literals > best.literals) best = { route: candidate, params, literals };
  }
  if (best !== null) return { route: best.route, params: best.params };
  return pathMatched ? 'method' : null;
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(errors.tooLarge(max));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject(errors.badRequest()));
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

async function enforceRate(bucket: string, limit: number): Promise<void> {
  const since = nowMs() - 60000;
  await db.query('delete from rate_events where at_ms < $1', [since - 60000]);
  const rows = await db.query<{ count: string; oldest: string }>(
    'select count(*)::text as count, coalesce(min(at_ms), 0)::text as oldest from rate_events where bucket = $1 and at_ms >= $2',
    [bucket, since],
  );
  const used = Number(rows[0]?.count ?? '0');
  if (used >= limit) {
    const oldest = Number(rows[0]?.oldest ?? nowMs());
    const seconds = Math.max(1, Math.ceil((oldest + 60000 - nowMs()) / 1000));
    throw errors.rateLimited(seconds);
  }
  await db.query('insert into rate_events (bucket, at_ms) values ($1, $2)', [bucket, nowMs()]);
}

export async function noteRate(bucket: string, limit: number): Promise<void> {
  await enforceRate(bucket, limit);
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const found = match(req.method ?? 'GET', url.pathname);
  if (found === null) return false;
  if (found === 'method') {
    sendJson(res, 405, errors.methodNotAllowed().body());
    return true;
  }
  const { route: matched, params } = found;
  const limit = bodyLimits[matched.options.limit ?? 'normal'];
  try {
    const rawBody = req.method === 'GET' || req.method === 'DELETE' ? '' : await readBody(req, limit);
    let body: Record<string, unknown> = {};
    const isJsonRoute = matched.options.limit !== 'importPack';
    if (rawBody.length > 0 && isJsonRoute) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      } catch {
        throw errors.badRequest();
      }
    }
    if (matched.options.grading === true && !config.grading) throw errors.notFound();
    let user: User | null = null;
    if (matched.options.auth !== false) {
      const token = readCookie(req.headers.cookie, 'spur_session');
      user = token === null ? null : await userForToken(token);
      if (user === null) throw errors.unauthenticated();
    }
    if (matched.options.write === true && user !== null) {
      await enforceRate(`write:${user.id}`, config.writeRate);
    }
    const ctx: Ctx = {
      req,
      res,
      method: req.method ?? 'GET',
      url,
      params,
      body,
      rawBody,
      user: user ?? ({ id: 0, username: '', time_zone: 'UTC' } as User),
      headers: req.headers as Record<string, string | undefined>,
    };
    const key = matched.options.idempotent === true ? ctx.headers['idempotency-key'] : undefined;
    if (typeof key === 'string' && key.length > 0 && user !== null) {
      const hash = createHash('sha256').update(rawBody).digest('hex');
      const stored = await db.one<{ body_hash: string; status: number; response: unknown }>(
        'select body_hash, status, response from idempotency_keys where key = $1 and user_id = $2 and at_ms > $3',
        [key, user.id, nowMs() - 86400000],
      );
      if (stored !== null) {
        if (stored.body_hash !== hash) {
          throw errors.conflict('idempotency_conflict', 'This idempotency key was used with a different request.');
        }
        sendJson(res, stored.status, stored.response, { 'idempotent-replay': 'true' });
        return true;
      }
      const reply = await matched.handler(ctx);
      if (reply !== 'handled') {
        await db.query(
          `insert into idempotency_keys (key, user_id, body_hash, status, response, at_ms)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (key, user_id) do update set status = $4, response = $5, at_ms = $6`,
          [key, user.id, hash, reply.status, JSON.stringify(reply.body), nowMs()],
        );
        sendJson(res, reply.status, reply.body, reply.headers);
      }
      return true;
    }
    const reply = await matched.handler(ctx);
    if (reply !== 'handled') sendJson(res, reply.status, reply.body, reply.headers);
    return true;
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, error.body());
      return true;
    }
    if (error instanceof StorageUnavailable || storageForcedDown()) {
      const failure = errors.storageUnavailable(storageOutageText);
      sendJson(res, failure.status, failure.body());
      return true;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendJson(res, 500, { error: 'server_error', message: 'Something went wrong.' });
    return true;
  }
}

export function queryNumber(ctx: Ctx, name: string): number | null {
  const raw = ctx.url.searchParams.get(name);
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function param(ctx: Ctx, name: string): number {
  const value = Number(ctx.params[name]);
  if (!Number.isInteger(value)) throw errors.notFound();
  return value;
}

export function text(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  return typeof value === 'string' ? value : null;
}

export function stringList(body: Record<string, unknown>, name: string): string[] | null {
  const value = body[name];
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}
