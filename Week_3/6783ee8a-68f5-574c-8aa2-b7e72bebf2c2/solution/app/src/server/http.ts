import type { IncomingMessage, ServerResponse } from "node:http";
import type { PoolClient } from "pg";
import type { FieldError, Role, User } from "../shared/api";
import { settings, JSON_BODY_LIMIT } from "./config";
import { pool, queryOne } from "./db";
import type { Db } from "./db";
import { ApiError, crossOrigin, forbidden, mailUnavailable, notFound, searchUnavailable, sendError, storageUnavailable, tooLarge, unauthenticated, validationFailed } from "./errors";
import { MailUnavailable } from "./mail";
import { SearchUnavailable } from "./search";
import { sessionToken, userFromRequest } from "./session";
import { withoutNul } from "./validate";
import { StorageUnavailable } from "./storage";

/** What a handler answers: JSON, raw bytes with their own headers, or a stream it writes itself. */
export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
  stream?: (res: ServerResponse) => void;
}

export const reply = (status: number, json?: unknown, headers?: Record<string, string>): Reply => ({ status, json, headers });

/** The notebook a request names, with the caller's role in it. */
export interface Access {
  id: string;
  role: Role;
  owner_id: string;
}

/** A transaction that commits when the request succeeds, plus hooks that run only after it did. */
export class Context {
  params: Record<string, string> = {};
  viewer: User | null = null;
  access: Access | null = null;
  private client: PoolClient | null = null;
  private readonly hooks: (() => void)[] = [];

  constructor(
    readonly req: IncomingMessage,
    readonly url: URL,
  ) {}

  me(): User {
    if (!this.viewer) throw unauthenticated();
    return this.viewer;
  }

  notebook(): Access {
    if (!this.access) throw notFound();
    return this.access;
  }

  async transaction(): Promise<PoolClient> {
    if (!this.client) {
      this.client = await pool.connect();
      await this.client.query("BEGIN");
    }
    return this.client;
  }

  afterCommit(hook: () => void): void {
    this.hooks.push(hook);
  }

  async commit(): Promise<void> {
    if (this.client) await this.client.query("COMMIT");
    this.hooks.forEach((hook) => hook());
  }

  async release(committed: boolean): Promise<void> {
    if (!this.client) return;
    if (!committed) await this.client.query("ROLLBACK").catch(() => undefined);
    this.client.release();
    this.client = null;
  }
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/** The caller's role in a notebook, or null when they may not open it. */
async function roleIn(db: Db, userId: string, notebookId: string): Promise<Access | null> {
  return queryOne<Access>(
    db,
    `SELECT n.id, n.owner_id,
            CASE WHEN n.owner_id = $1 THEN 'owner' ELSE s.role END AS role
       FROM notebooks n
       LEFT JOIN shares s ON s.notebook_id = n.id AND s.user_id = $1 AND s.status = 'active'
      WHERE n.id = $2 AND (n.owner_id = $1 OR s.id IS NOT NULL)`,
    [userId, notebookId],
  );
}

interface RouteSpec<Resource, Body> {
  method: "GET" | "POST" | "DELETE";
  path: string;
  access: "session" | "public";
  /** A notebook route: 404 when the caller may not open it, 403 below this role. */
  notebook?: Role;
  /** A write route: the notebook row is locked for the rest of the request. */
  write?: boolean;
  /** 404: find what the path names beyond the notebook. */
  resolve?: (ctx: Context) => Promise<Resource>;
  body?: "json" | "raw";
  limit?: () => number;
  tooLarge?: (limit: number) => ApiError;
  /** A replayed request answers with what it answered before. */
  replay?: (ctx: Context, resource: Resource, body: unknown) => Promise<Reply | null>;
  /** 409: stale revision and state conflicts, decided with the notebook locked. */
  check?: (ctx: Context, resource: Resource, body: unknown) => Promise<void>;
  /** 422: turn the body into what `run` needs. */
  validate?: (body: unknown, resource: Resource, ctx: Context) => Body | Promise<Body>;
  /** The work; 503 comes from the providers it calls. */
  run: (ctx: Context, resource: Resource, body: Body) => Promise<Reply>;
}

export interface Route {
  method: string;
  segments: string[];
  handle: (ctx: Context) => Promise<Reply>;
}

type BodyRead = { bytes: Buffer } | { oversize: true };

function readBody(req: IncomingMessage, limit: number): Promise<BodyRead> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else if (!settled) {
        settled = true;
        resolve({ oversize: true });
      }
    });
    req.on("end", () => {
      if (!settled) resolve({ bytes: Buffer.concat(chunks) });
    });
    req.on("error", reject);
  });
}

/** Collects 422 entries and throws them as one error. */
export class Problems {
  readonly list: FieldError[] = [];
  add(path: string, message: string): void {
    this.list.push({ path, message });
  }
  done(): void {
    if (this.list.length) throw validationFailed(this.list);
  }
}

function parseJson(bytes: Buffer): unknown {
  if (bytes.length === 0) return {};
  try {
    return JSON.parse(withoutNul(bytes.toString("utf8")));
  } catch {
    throw validationFailed([{ path: "body", message: "must be valid JSON" }]);
  }
}

function foreignOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    return host !== req.headers.host && host !== new URL(settings.publicUrl).host;
  } catch {
    return true;
  }
}

/** A route's request pipeline. The order of its phases is the brief's error precedence:
 *  401, 404, 403, 413, replay, 409, 422, 503. */
export function defineRoute<Resource = undefined, Body = unknown>(spec: RouteSpec<Resource, Body>): Route {
  return {
    method: spec.method,
    segments: spec.path.split("/").filter(Boolean),
    handle: async (ctx) => {
      if (spec.method !== "GET" && foreignOrigin(ctx.req)) throw crossOrigin();
      if (spec.access === "session") ctx.me();
      if (spec.notebook) {
        ctx.access = await roleIn(pool, ctx.me().id, ctx.params.id as string);
        if (!ctx.access) throw notFound();
      }
      const resource = (await spec.resolve?.(ctx)) as Resource;
      if (spec.notebook && RANK[ctx.notebook().role] < RANK[spec.notebook]) throw forbidden();
      let raw: unknown;
      if (spec.body) {
        const limit = spec.limit?.() ?? JSON_BODY_LIMIT;
        const read = await readBody(ctx.req, limit);
        if ("oversize" in read) throw spec.tooLarge ? spec.tooLarge(limit) : tooLarge(`Request body is larger than ${limit.toLocaleString("en-US")} bytes`);
        raw = spec.body === "json" ? parseJson(read.bytes) : read.bytes;
      }
      if (spec.write) {
        const db = await ctx.transaction();
        const locked = await queryOne<{ id: string }>(db, "SELECT id FROM notebooks WHERE id = $1 FOR UPDATE", [ctx.notebook().id]);
        if (!locked) throw notFound();
      }
      const replayed = await spec.replay?.(ctx, resource, raw);
      if (replayed) return replayed;
      await spec.check?.(ctx, resource, raw);
      const valid = spec.validate ? await spec.validate(raw, resource, ctx) : (raw as Body);
      return spec.run(ctx, resource, valid);
    },
  };
}

function writeReply(res: ServerResponse, answer: Reply): void {
  const headers: Record<string, string> = { "cache-control": "no-store", ...answer.headers };
  if (answer.stream) {
    answer.stream(res);
  } else if (answer.bytes) {
    res.writeHead(answer.status, { "content-type": "application/octet-stream", ...headers });
    res.end(answer.bytes);
  } else if (answer.json === undefined) {
    res.writeHead(answer.status, headers);
    res.end();
  } else {
    res.writeHead(answer.status, { "content-type": "application/json; charset=utf-8", ...headers });
    res.end(JSON.stringify(answer.json));
  }
}

function matchRoute(routes: readonly Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method || route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const matches = route.segments.every((segment, index) => {
      const part = parts[index] as string;
      if (!segment.startsWith(":")) return segment === part;
      try {
        const value = decodeURIComponent(part);
        if (value.includes("\u0000")) return false;
        params[segment.slice(1)] = value;
        return true;
      } catch {
        return false;
      }
    });
    if (matches) return { route, params };
  }
  return null;
}

/** Provider failures become their 503; anything unexpected is a 500. */
function apiErrorOf(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StorageUnavailable) return storageUnavailable();
  if (error instanceof MailUnavailable) return mailUnavailable();
  if (error instanceof SearchUnavailable) return searchUnavailable();
  return new ApiError(500, "internal_error", "Something went wrong.");
}

export async function dispatch(routes: readonly Route[], req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const ctx = new Context(req, url);
  let committed = false;
  try {
    const found = matchRoute(routes, req.method ?? "GET", url.pathname);
    if (!found) throw notFound();
    ctx.params = found.params;
    ctx.viewer = sessionToken(req) ? await userFromRequest(req) : null;
    const answer = await found.route.handle(ctx);
    await ctx.commit();
    committed = true;
    writeReply(res, answer);
  } catch (error) {
    const failure = apiErrorOf(error);
    if (failure.status === 500) console.error(error);
    sendError(res, failure);
    req.resume();
  } finally {
    await ctx.release(committed);
  }
}
