// The request boundary: routing, cookies, body limits, the cross-origin check and the single error order's
// first two steps. Handlers decide the rest.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Json } from "../shared/canonical";
import type { User } from "./auth";
import { sessionUser } from "./auth";
import { config } from "./config";
import { SESSION_COOKIE, VISITOR_COOKIE, visitorCookie } from "./cookies";
import { database } from "./db";
import { ApiError, DOWNLOAD_OUTAGE, SAVE_OUTAGE, StorageUnavailable, notFound, storageOutage, tooLarge, unauthenticated } from "./errors";
import { checkNumberGrammar, parseBody, type ParsedBody } from "./number-grammar";
import { errorReply, type Reply } from "./reply";
import { HANDLED, type Route } from "./route";
import { serveStatic } from "./static";

const BODY_LIMIT = 65536;
const SETUP_BODY_LIMIT = 1_000_000;
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return cookies;
}

/**
 * Keyed writes from one session to one path claim their Idempotency-Key in the order they arrived, so the
 * awaits before the claim (body, session, lookups) cannot let a later duplicate overtake the first.
 */
const claimLanes = new Map<string, Promise<void>>();

export class Ctx {
  readonly url: URL;
  params: Record<string, string> = {};
  readonly cookies: Map<string, string>;
  /** Aborts when the client leaves before the answer is complete. */
  readonly closed = new AbortController();
  readonly visitorId: string;
  readonly responseCookies: string[] = [];
  private raw = "";
  private parsed: ParsedBody | null = null;
  private userLookup: Promise<User | null> | null = null;
  /** Settles when every earlier request in this request's claim lane has claimed its key or finished. */
  readonly claimTurn: Promise<void> = Promise.resolve();
  /** Lets the next request in the lane claim; safe to call more than once. */
  claimed: () => void = () => {};

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
  ) {
    this.url = new URL(req.url ?? "/", "http://localhost");
    this.cookies = parseCookies(req.headers.cookie);
    const known = this.cookies.get(VISITOR_COOKIE);
    this.visitorId = known ?? randomUUID();
    if (known === undefined && this.url.pathname.startsWith("/api/")) {
      this.responseCookies.push(visitorCookie(this.visitorId));
    }
    res.on("close", () => {
      if (!res.writableEnded) this.closed.abort();
    });
    const key = req.headers["idempotency-key"];
    if (typeof key === "string" && STATE_CHANGING.has(req.method ?? "")) {
      const lane = JSON.stringify([this.cookies.get(SESSION_COOKIE) ?? "", req.method, this.url.pathname, key]);
      let release!: () => void;
      const mine = new Promise<void>((resolve) => (release = resolve));
      this.claimTurn = claimLanes.get(lane) ?? Promise.resolve();
      const tail = this.claimTurn.then(() => mine);
      claimLanes.set(lane, tail);
      this.claimed = () => {
        release();
        if (claimLanes.get(lane) === tail) void tail.then(() => claimLanes.get(lane) === tail && claimLanes.delete(lane));
      };
    }
  }

  header(name: string): string | undefined {
    const value = this.req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  user(): Promise<User | null> {
    const token = this.cookies.get(SESSION_COOKIE);
    this.userLookup ??= token ? sessionUser(token) : Promise.resolve(null);
    return this.userLookup;
  }

  async requireUser(): Promise<User> {
    const user = await this.user();
    if (!user) throw unauthenticated();
    return user;
  }

  setBody(raw: string): void {
    this.raw = raw;
  }

  private body(): ParsedBody {
    this.parsed ??= this.raw.trim() === "" ? { value: {}, scalars: [] } : parseBody(this.raw);
    return this.parsed;
  }

  /** The request body as an object; an empty body is `{}`. */
  json(): Record<string, Json> {
    const { value } = this.body();
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }

  /** House rule H1 on the request text; the first step of validation. */
  checkNumbers(numericParameters: ReadonlySet<string> = new Set()): void {
    checkNumberGrammar(this.body(), numericParameters);
  }

  /** The Idempotency-Key header, or null when none was sent. */
  idempotencyKey(): string | null {
    const key = this.header("idempotency-key");
    if (key === undefined) return null;
    if (!/^[\x20-\x7e]{1,255}$/.test(key)) {
      throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key must be 1 to 255 printable characters.");
    }
    return key;
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw tooLarge(limit);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw tooLarge(limit);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    const url = new URL(origin);
    return url.host === host || url.origin === new URL(config.publicUrl).origin;
  } catch {
    return false;
  }
}

function send(ctx: Ctx, reply: Reply): void {
  const headers: Record<string, string | string[]> = { ...reply.headers };
  if (ctx.responseCookies.length > 0) headers["Set-Cookie"] = ctx.responseCookies;
  ctx.res.writeHead(reply.status, headers);
  ctx.res.end(reply.body);
}

function failure(route: Route | null, error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StorageUnavailable) {
    if (route?.outage) return storageOutage(route.outage === "download" ? DOWNLOAD_OUTAGE : SAVE_OUTAGE);
  }
  console.error(error);
  return new ApiError(500, "internal", "Something went wrong.");
}

/** The route a request addresses and its decoded path parameters; null when none matches or one cannot be decoded. */
function match(routes: Route[], method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const found = route.method === method ? route.pattern.exec(path) : null;
    if (!found) continue;
    try {
      return { route, params: Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(found[i + 1] ?? "")])) };
    } catch {
      return null;
    }
  }
  return null;
}

export function createHandler(routes: Route[]): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const ctx = new Ctx(req, res);
    const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
    const path = ctx.url.pathname;
    const matched = match(routes, method, path);
    void (async () => {
      try {
        if (/%00/i.test(req.url ?? "")) throw notFound();
        if (STATE_CHANGING.has(method)) {
          const origin = ctx.header("origin");
          if (origin !== undefined && !sameOrigin(origin, ctx.header("host"))) {
            throw new ApiError(403, "cross_origin", "Requests must come from Tinework.");
          }
          ctx.setBody(await readBody(req, path === "/api/grading/setup" ? SETUP_BODY_LIMIT : BODY_LIMIT));
        }
        if (!matched) {
          if (method === "GET" && !path.startsWith("/api/")) {
            await serveStatic(ctx);
            return;
          }
          throw notFound();
        }
        if (matched.route.needsDatabase && !database.ready) {
          throw new ApiError(503, "database_unavailable", "The database is not reachable. Try again in a minute.");
        }
        ctx.params = matched.params;
        const reply = await matched.route.handler(ctx);
        ctx.claimed();
        if (reply !== HANDLED) send(ctx, reply);
      } catch (error) {
        ctx.claimed();
        const api = failure(matched?.route ?? null, error);
        if (ctx.res.headersSent) {
          ctx.res.destroy();
          return;
        }
        if (api.status === 413) api.headers.Connection = "close";
        send(ctx, errorReply(api));
      }
    })();
  };
}
