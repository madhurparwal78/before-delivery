// Request handling: routing, the published body limits, the same-origin rule, the session gate
// and the error precedence of the brief (size and type, database, auth, replay, then handlers).
import type { IncomingMessage, ServerResponse } from "node:http";
import { viewerOf, type Viewer } from "./access.js";
import { authenticate, type SessionPerson } from "./auth.js";
import { query, type Db } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { withIdempotency } from "./idempotency.js";
import { routes, type Route } from "./router.js";
import { FILE_LIMIT } from "../shared/text.js";

const JSON_LIMIT = 1_000_000;
export const UPLOAD_LIMIT = FILE_LIMIT + 1_000_000;

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export class Ctx {
  /** Stores an idempotent answer in the transaction that did the work, so the two commit together. */
  settle: (db: Db, reply: Reply) => Promise<void> = async () => undefined;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly params: Record<string, string>,
    readonly query: URLSearchParams,
    private readonly parsed: Record<string, unknown> | ApiError,
    private readonly session: SessionPerson | null,
  ) {}

  /** The JSON body; a malformed one fails here, after the session and role checks. */
  get body(): Record<string, unknown> {
    if (this.parsed instanceof ApiError) throw this.parsed;
    return this.parsed;
  }

  /** The signed-in person (any route except public ones). */
  get person(): SessionPerson {
    if (!this.session) throw new ApiError("unauthenticated");
    return this.session;
  }

  /** The signed-in person with their workspace (workspace routes). */
  get viewer(): Viewer {
    const viewer = viewerOf(this.person);
    if (!viewer) throw new ApiError("forbidden");
    return viewer;
  }

  owner(): Viewer {
    const viewer = this.viewer;
    if (viewer.role !== "owner") throw new ApiError("forbidden");
    return viewer;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...(payload ? { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(payload)) } : {}),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body());
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === "") return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | ApiError> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > JSON_LIMIT) throw new ApiError("too_large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > JSON_LIMIT) throw new ApiError("too_large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // reported as the same validation error below
  }
  return invalid({ body: "Send a JSON object." });
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const OPEN = new Set(["/api/health", "/api/status"]);

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  try {
    if (STATE_CHANGING.has(method) && !sameOrigin(req)) throw new ApiError("cross_origin");
    let matched: Route | undefined;
    let params: Record<string, string> = {};
    for (const candidate of routes) {
      if (candidate.method !== method) continue;
      const found = candidate.pattern.exec(url.pathname);
      if (!found) continue;
      matched = candidate;
      try {
        params = Object.fromEntries(candidate.names.map((name, i) => [name, decodeURIComponent(found[i + 1] ?? "")]));
      } catch {
        throw new ApiError("not_found");
      }
      break;
    }

    let body: Record<string, unknown> | ApiError = {};
    if (matched && method !== "GET" && method !== "DELETE") {
      if (!matched.json) {
        if (Number(req.headers["content-length"] ?? 0) > UPLOAD_LIMIT) throw new ApiError("too_large");
        if (!/^multipart\/form-data\s*;/i.test(req.headers["content-type"] ?? "")) throw new ApiError("unsupported_media_type");
      } else {
        const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
        if (hasBody && type !== "application/json") throw new ApiError("unsupported_media_type");
        body = await readBody(req);
      }
    }

    if (matched && OPEN.has(url.pathname)) {
      const reply = await matched.handler(new Ctx(req, res, params, url.searchParams, body, null));
      if (reply) sendJson(res, reply.status, reply.body, reply.headers);
      return;
    }

    const session = await authenticate(req);
    if (!matched) {
      if (!session) throw new ApiError("unauthenticated");
      throw new ApiError("not_found");
    }
    if (matched.access === "public") await query("SELECT 1");
    else if (!session) throw new ApiError("unauthenticated");
    else if (matched.access === "workspace" && !viewerOf(session)) throw new ApiError("forbidden");

    const ctx = new Ctx(req, res, params, url.searchParams, body, session);
    const run = async (): Promise<Reply | void> => matched.handler(ctx);
    const key = req.headers["idempotency-key"];
    const reply =
      matched.idempotent && typeof key === "string" && !(body instanceof ApiError)
        ? await withIdempotency(ctx.viewer.id, `${method} ${url.pathname}`, key, body, run, (settle) => (ctx.settle = settle))
        : await run();
    if (reply) sendJson(res, reply.status, reply.body, reply.headers);
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    console.error(error);
    sendError(res, new ApiError("database_unavailable"));
  }
}
