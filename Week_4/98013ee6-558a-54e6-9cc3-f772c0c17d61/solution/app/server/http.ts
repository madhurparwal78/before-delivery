import type { IncomingMessage, ServerResponse } from "node:http";
import { JSON_BODY_LIMIT } from "./config.js";
import { isRecord } from "../shared/guards.js";
import { ApiError, forbidden, internalError, notFound, tooLarge, unauthorized, validation } from "./errors.js";

export interface SessionUser {
  id: number;
  name: string;
  handle: string;
  email: string;
}

export class Reply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
    readonly headers: Record<string, string | string[]> = {},
  ) {}
}

export class RawReply {
  constructor(
    readonly status: number,
    readonly contentType: string,
    readonly data: Buffer,
    readonly headers: Record<string, string> = {},
  ) {}
}

export const ok = (body: unknown, headers?: Record<string, string | string[]>): Reply => new Reply(200, body, headers);
export const created = (body: unknown): Reply => new Reply(201, body);
export const accepted = (body: unknown): Reply => new Reply(202, body);
export const noContent = (headers?: Record<string, string | string[]>): Reply => new Reply(204, undefined, headers);

/** A parsed JSON object. Fields are validated by the caller at the point the error order allows. */
export class Body {
  constructor(private readonly data: Record<string, unknown>) {}
  get(key: string): unknown {
    return this.data[key];
  }
  record(): Record<string, unknown> {
    return this.data;
  }
  has(key: string): boolean {
    return key in this.data;
  }
  string(key: string): string {
    const value = this.data[key];
    if (typeof value !== "string") throw validation(key);
    return value;
  }
  integer(key: string): number {
    const value = this.data[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw validation(key);
    return value;
  }
  /** A reference to another record: a positive integer, or "not found" for anything else. */
  reference(key: string): number {
    const value = this.data[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw notFound();
    return value;
  }
  integerOrNull(key: string): number | null {
    const value = this.data[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw validation(key);
    return value;
  }
}

export interface Ctx {
  req: IncomingMessage;
  query: URLSearchParams;
  params: Record<string, string>;
  user: SessionUser | null;
  /** The signed-in user. Routes registered with `auth: true` always have one. */
  me(): SessionUser;
  /** A positive integer path parameter, or "not found" for anything else. */
  id(name: string): number;
  json(): Promise<Body>;
}

type Handler = (ctx: Ctx) => Promise<Reply | RawReply>;

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  auth: boolean;
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, auth: boolean, handler: Handler): void {
    const names: string[] = [];
    const source = path.replace(/:([a-z_]+)/g, (_match, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), names, auth, handler });
  }

  find(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      const params: Record<string, string> = {};
      let usable = true;
      route.names.forEach((name, index) => {
        try {
          params[name] = decodeURIComponent(match[index + 1] ?? "");
        } catch {
          usable = false;
        }
        // A NUL byte can never be in a stored value: the path names nothing.
        if (params[name]?.includes("\0")) usable = false;
      });
      if (!usable) return null;
      return { route, params };
    }
    return null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

async function readLimited(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size <= limit) chunks.push(piece);
    else if (size > limit + 16 * 1024 * 1024) req.destroy();
  }
  if (size > limit) throw tooLarge(limit);
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Body> {
  const raw = await readLimited(req, JSON_BODY_LIMIT);
  if (raw.length === 0) return new Body({});
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    return new Body(isRecord(parsed) ? parsed : {});
  } catch {
    return new Body({});
  }
}

export async function dispatch(
  router: Router,
  req: IncomingMessage,
  url: URL,
  resolveUser: (req: IncomingMessage) => Promise<SessionUser | null>,
): Promise<Reply | RawReply | null> {
  const found = router.find(req.method ?? "GET", url.pathname);
  if (!found) return null;
  const user = await resolveUser(req);
  if (found.route.auth && !user) throw unauthorized();
  if (!SAFE_METHODS.has(req.method ?? "GET") && !isSameOrigin(req)) throw forbidden();
  let cached: Promise<Body> | null = null;
  const ctx: Ctx = {
    req,
    query: url.searchParams,
    params: found.params,
    user,
    me: () => {
      if (!user) throw unauthorized();
      return user;
    },
    id: (name) => {
      const value = found.params[name];
      if (!/^[1-9][0-9]{0,15}$/.test(value)) throw notFound();
      return Number(value);
    },
    json: () => (cached ??= readJson(req)),
  };
  return found.route.handler(ctx);
}

export function writeReply(res: ServerResponse, reply: Reply | RawReply): void {
  if (reply instanceof RawReply) {
    res.writeHead(reply.status, { "Content-Type": reply.contentType, "Content-Length": reply.data.length, ...reply.headers });
    res.end(reply.data);
    return;
  }
  const headers: Record<string, string | string[] | number> = { ...reply.headers };
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body), "utf8");
  headers["Content-Type"] = "application/json; charset=utf-8";
  headers["Content-Length"] = payload.length;
  res.writeHead(reply.status, headers);
  res.end(payload);
}

export function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    writeReply(res, new Reply(error.status, error.body));
    return;
  }
  console.error(error);
  writeError(res, internalError());
}
