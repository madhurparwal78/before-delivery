import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { db, type Queryable } from './db.js';
import { ApiError, databaseUnavailable, fail, forbidden, notFound, tooLarge, unauthenticated, liveUnavailable, storageUnavailable } from './errors.js';
import { Input } from './validate.js';
import { store } from './s3.js';
import { valkey } from './valkey.js';
import type { Role } from '../shared/types.js';

const LIMITS = { json: 100_000, multipart: 5_100_000, thumbnail: 500_000 } as const;
const READ_CAP = 64_000_000;
const COOKIE = 'kb_session';
const COOKIE_SECONDS = 30 * 24 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Actor {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  workspaceId: string;
  workspaceName: string;
}

export type Reply =
  | { status: number; body?: unknown; headers?: Record<string, string | number>; bytes?: Buffer }
  | { stream: (res: ServerResponse) => void };

export const json = (status: number, body: unknown, headers?: Record<string, string | number>): Reply => ({ status, body, headers });
export const empty = (status = 204): Reply => ({ status });

export class Ctx {
  actor!: Actor;
  db: Queryable = db;
  /** The request's one moment: a read settles expired sessions and reports the clock at this same instant. */
  readonly now = new Date();
  readonly after: (() => Promise<void> | void)[] = [];
  /** Undo work for side effects outside the database (stored objects), run when the request fails after making them. */
  readonly rollbacks: (() => Promise<void>)[] = [];
  private parsed: { value: unknown; valid: boolean } | null = null;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly params: Record<string, string>,
    readonly query: URLSearchParams,
    readonly raw: Buffer,
  ) {}

  header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  /** The parsed JSON body, or undefined when it is empty or not valid JSON. */
  get body(): unknown {
    return this.parse().valid ? this.parsed!.value : undefined;
  }

  private parse(): { value: unknown; valid: boolean } {
    if (!this.parsed) {
      try {
        this.parsed = { value: JSON.parse(this.raw.toString('utf8')), valid: true };
      } catch {
        this.parsed = { value: undefined, valid: false };
      }
    }
    return this.parsed;
  }

  /** The request body as validated fields. */
  input(): Input {
    const input = Input.from(this.body);
    if (!this.parse().valid) input.fields.add('body', 'must be valid JSON');
    return input;
  }
}

type Dependency = 'valkey' | 'storage';

/**
 * One route. The pipeline runs these stages in the brief's precedence order:
 * 2 auth (401), 3 load (404), 4 role (403), 5 replay, 6 conflict (409/410/412/429), 7 validate (422), 8 needs (503).
 * Body size (413) and cross-origin writes (403) are decided before any of them, in `dispatch`.
 */
interface Spec<L, V> {
  auth: 'none' | 'member';
  limit?: keyof typeof LIMITS;
  /** Run stages 3 to the handler inside one database transaction. */
  transaction?: boolean;
  load?: (ctx: Ctx) => Promise<L>;
  role?: (ctx: Ctx, loaded: L) => boolean;
  replay?: (ctx: Ctx, loaded: L) => Promise<Reply | undefined>;
  conflict?: (ctx: Ctx, loaded: L) => Promise<void>;
  validate?: (ctx: Ctx, loaded: L) => V | Promise<V>;
  needs?: Dependency[];
  run: (ctx: Ctx, loaded: L, input: V) => Promise<Reply>;
}

type Handler = (ctx: Ctx) => Promise<Reply>;

interface Registered {
  method: string;
  pattern: RegExp;
  names: string[];
  limit: number;
  hasBody: boolean;
  handler: Handler;
}

const registry: Registered[] = [];

function requireService(need: Dependency): void {
  if (need === 'valkey' && !valkey.available) throw liveUnavailable();
  if (need === 'storage' && !store.available) throw storageUnavailable();
}

export function route<L = undefined, V = undefined>(method: string, path: string, spec: Spec<L, V>): void {
  const names: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, name: string) => (names.push(name), '([^/]+)'))}$`);
  const handler: Handler = async (ctx) => {
    if (spec.auth === 'member') ctx.actor = await authenticate(ctx);
    const stages = async (client: Queryable): Promise<Reply> => {
      ctx.db = client;
      // A NUL byte names nothing and Postgres cannot hold it in text: 404 before any lookup.
      if (names.some((name) => (name.endsWith('Id') && !UUID.test(ctx.params[name] ?? '')) || (ctx.params[name] ?? '').includes('\0'))) throw notFound();
      const loaded = (spec.load ? await spec.load(ctx) : undefined) as L;
      if (spec.role && !spec.role(ctx, loaded)) throw forbidden();
      const replayed = spec.replay ? await spec.replay(ctx, loaded) : undefined;
      if (replayed) return replayed;
      if (spec.conflict) await spec.conflict(ctx, loaded);
      const input = (spec.validate ? await spec.validate(ctx, loaded) : undefined) as V;
      for (const need of spec.needs ?? []) requireService(need);
      return spec.run(ctx, loaded, input);
    };
    let reply: Reply;
    try {
      reply = spec.transaction ? await db.transaction(stages) : await stages(db);
    } catch (error) {
      await Promise.all(ctx.rollbacks.map((undo) => undo().catch(() => undefined)));
      throw error;
    }
    for (const hook of ctx.after) {
      try {
        await hook();
      } catch {
        // An event that cannot be published never fails the request that was already committed.
      }
    }
    return reply;
  };
  const writes = method !== 'GET' && method !== 'DELETE';
  registry.push({ method, pattern, names, limit: LIMITS[spec.limit ?? 'json'], hasBody: writes, handler });
}

/* ---------- accounts' cookie ---------- */

let cookieSecret = '';

export function useCookieSecret(secret: string): void {
  cookieSecret = secret;
}

const mac = (id: string): string => createHmac('sha256', cookieSecret).update(id).digest('base64url');

export function newLoginId(): string {
  return randomBytes(24).toString('base64url');
}

export function sessionCookie(loginId: string): string {
  return `${COOKIE}=${loginId}.${mac(loginId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_SECONDS}`;
}

export const clearedCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export function loginIdOf(ctx: Ctx): string | null {
  const header = ctx.header('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== COOKIE) continue;
    const [id, signature] = rest.join('=').split('.');
    if (!id || !signature) return null;
    const expected = Buffer.from(mac(id));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
  }
  return null;
}

async function authenticate(ctx: Ctx): Promise<Actor> {
  const id = loginIdOf(ctx);
  if (!id) throw unauthenticated();
  const found = await db.query<{ id: string; email: string; display_name: string; role: Role; workspace_id: string; workspace_name: string }>(
    `SELECT u.id, u.email, u.display_name, u.role, u.workspace_id, w.name AS workspace_name
     FROM logins l JOIN users u ON u.id = l.user_id JOIN workspaces w ON w.id = u.workspace_id WHERE l.id = $1`,
    [id],
  );
  const row = found.rows[0];
  if (!row) throw unauthenticated();
  return { userId: row.id, email: row.email, displayName: row.display_name, role: row.role, workspaceId: row.workspace_id, workspaceName: row.workspace_name };
}

/* ---------- dispatch ---------- */

async function readBody(req: IncomingMessage): Promise<{ bytes: Buffer; size: number }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= READ_CAP) chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), size };
}

function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host && origin !== config.publicOrigin;
  } catch {
    return true;
  }
}

/** Answers a refusal in the one error shape (also for routes that never reach the pipeline). */
export function refuse(res: ServerResponse, error: ApiError): void {
  send(res, json(error.status, error.body));
}

function send(res: ServerResponse, reply: Reply): void {
  if ('stream' in reply) {
    reply.stream(res);
    return;
  }
  const bytes = reply.bytes ?? (reply.body === undefined ? undefined : Buffer.from(JSON.stringify(reply.body)));
  const headers: Record<string, string | number> = { ...reply.headers };
  if (reply.body !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
  if (bytes && reply.status !== 304) headers['content-length'] = bytes.length;
  res.writeHead(reply.status, headers);
  res.end(reply.status === 304 || reply.status === 204 ? undefined : bytes);
}

/** A malformed percent-escape names nothing: it decodes to itself and the lookup answers 404. */
export function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET';
  let matched: { entry: Registered; params: Record<string, string> } | null = null;
  for (const entry of registry) {
    if (entry.method !== method) continue;
    const hit = entry.pattern.exec(url.pathname);
    if (hit) {
      matched = { entry, params: Object.fromEntries(entry.names.map((name, i) => [name, safeDecode(hit[i + 1]!)])) };
      break;
    }
  }
  if (!matched) return false;
  try {
    if (method !== 'GET' && crossOrigin(req)) throw fail(403, 'cross_origin');
    let raw: Buffer = Buffer.alloc(0);
    if (matched.entry.hasBody) {
      const body = await readBody(req);
      if (body.size > matched.entry.limit) throw tooLarge();
      raw = body.bytes;
    }
    if (!db.available && url.pathname !== '/api/health') throw databaseUnavailable();
    send(res, await matched.entry.handler(new Ctx(req, res, matched.params, url.searchParams, raw)));
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
    } else if (error instanceof ApiError) {
      refuse(res, error);
    } else {
      console.error(error);
      refuse(res, fail(500, 'internal'));
    }
  }
  return true;
}
