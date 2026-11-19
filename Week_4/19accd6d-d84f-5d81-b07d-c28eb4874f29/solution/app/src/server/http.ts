import type { IncomingMessage, ServerResponse } from "node:http";
import type { PoolClient } from "pg";
import type { SessionUser } from "../shared/api";
import { pool } from "./db";
import { ApiError, forbidden, notFound, payloadTooLarge, sendError, unauthenticated, validationFailed } from "./errors";
import { sessionToken, userFromRequest } from "./session";

const JSON_LIMIT = 1_000_000;

/** What a handler answers: JSON, or raw bytes with their own headers. */
interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

export const reply = (status: number, json?: unknown, headers?: Record<string, string>): Reply => ({ status, json, headers });

export class Context {
  params: Record<string, string> = {};
  viewer: SessionUser | null = null;
  private client: PoolClient | null = null;
  private readonly hooks: (() => void)[] = [];

  constructor(
    readonly req: IncomingMessage,
    readonly url: URL,
  ) {}

  /** The signed-in person; routes that need a session have already refused anyone else. */
  me(): SessionUser {
    if (!this.viewer) throw unauthenticated();
    return this.viewer;
  }

  /** A transaction that commits when the request succeeds and rolls back when it fails. */
  async transaction(): Promise<PoolClient> {
    if (!this.client) {
      this.client = await pool.connect();
      await this.client.query("BEGIN");
    }
    return this.client;
  }

  /** Runs after the transaction has committed: live messages and search updates. */
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

interface RouteSpec<Resource, Body, Checked> {
  method: "GET" | "POST" | "DELETE";
  path: string;
  access: "session" | "public";
  /** The kind of request body this route reads; routes without one never read the body. */
  body?: "json" | "raw";
  /** The largest body in bytes; defaults to 1,000,000. */
  limit?: () => number;
  /** The error for a body over the limit, when it is not the generic one. */
  tooLarge?: (size: number, limit: number) => ApiError;
  /** 404 and 403: find what the path names and check the person may touch it. */
  resolve?: (ctx: Context) => Promise<Resource>;
  /** 404, 403 and 409 that depend on the body; what it returns, when it returns something, is what `run` receives. */
  check?: (ctx: Context, resource: Resource, body: unknown) => Promise<Checked | void>;
  /** 422: turn the body into what `run` needs. */
  validate?: (body: unknown, resource: Resource, ctx: Context) => Body;
  /** The work itself; 503 comes from the dependencies it calls. */
  run: (ctx: Context, checked: Checked, body: Body) => Promise<Reply>;
}

export interface Route {
  method: string;
  segments: string[];
  handle: (ctx: Context) => Promise<Reply>;
}

type BodyRead = { bytes: Buffer } | { size: number };

function drainedBody(req: IncomingMessage, limit: number): Promise<BodyRead> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > limit ? { size } : { bytes: Buffer.concat(chunks) }));
    req.on("error", reject);
  });
}

function parseJsonBody(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw validationFailed({});
  }
}

/** A route's request pipeline. The order of its phases is the brief's error precedence: 401, 404, 403, 413, 409, 422, 503. */
export function defineRoute<Resource = undefined, Body = unknown, Checked = Resource>(spec: RouteSpec<Resource, Body, Checked>): Route {
  return {
    method: spec.method,
    segments: spec.path.split("/").filter(Boolean),
    handle: async (ctx) => {
      if (spec.access === "session" && !ctx.viewer) throw unauthenticated();
      if (spec.method !== "GET" && foreignOrigin(ctx.req)) throw forbidden("Requests from another origin are refused.");
      const resource = (await spec.resolve?.(ctx)) as Resource;
      let body: unknown;
      if (spec.body) {
        const limit = spec.limit?.() ?? JSON_LIMIT;
        const read = await drainedBody(ctx.req, limit);
        if ("size" in read) throw spec.tooLarge ? spec.tooLarge(read.size, limit) : payloadTooLarge(limit);
        body = spec.body === "json" ? parseJsonBody(read.bytes) : read.bytes;
      }
      const checked = ((await spec.check?.(ctx, resource, body)) ?? resource) as Checked;
      const valid = spec.validate ? spec.validate(body, resource, ctx) : (body as Body);
      return spec.run(ctx, checked, valid);
    },
  };
}

/** True when a browser sent an Origin that is not this server's own. */
export function foreignOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

function writeReply(res: ServerResponse, answer: Reply): void {
  const headers: Record<string, string> = { "cache-control": "no-store", ...answer.headers };
  if (answer.bytes) {
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
    const failure = error instanceof ApiError ? error : new ApiError(500, "internal_error", "Something went wrong.");
    if (!(error instanceof ApiError)) console.error(error);
    sendError(res, failure);
    req.resume();
  } finally {
    await ctx.release(committed);
  }
}
