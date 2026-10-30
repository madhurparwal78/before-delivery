// The router owns the single error precedence of the brief (API › Conventions):
// 405 → 413/415 → 401 → 404 (path ids) → 403 (role, origin) → the endpoint's own checks.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Role } from "../../shared/api.js";
import { currentSession, type Session } from "./auth.js";
import { readBody, type BodyKind, type Upload } from "./body.js";
import { ApiError, forbidden, notFound, unauthenticated } from "./errors.js";
import type { JsonObject } from "./validate.js";

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string>;
}

interface BaseCtx {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  body: JsonObject;
  upload: Upload | null;
}
export interface PublicCtx extends BaseCtx { session: Session | null }
export interface MemberCtx extends BaseCtx { session: Session }

export const ANY: readonly Role[] = ["head_of_product", "product_manager", "customer_success"];
export const HP: readonly Role[] = ["head_of_product", "product_manager"];
export const H: readonly Role[] = ["head_of_product"];

type Run = (ctx: PublicCtx) => Promise<Reply>;
export interface Endpoint { body: BodyKind; needsSession: boolean; run: Run }

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return origin === `http://${req.headers.host ?? ""}`;
}

function checkOrigin(ctx: BaseCtx): void {
  if (STATE_CHANGING.has(ctx.req.method ?? "") && !sameOrigin(ctx.req)) {
    throw new ApiError(403, "cross_origin", "Requests must come from this app's own pages.");
  }
}

/** An endpoint open to anyone (sessions, invitations, the public roadmap, health). */
export function open(spec: { body?: BodyKind; handle: (ctx: PublicCtx) => Promise<Reply> }): Endpoint {
  return {
    body: spec.body ?? "json",
    needsSession: false,
    run: async (ctx) => {
      checkOrigin(ctx);
      return spec.handle(ctx);
    },
  };
}

/** A member endpoint: `load` resolves path ids (404) before the role (403) is judged. */
export function member<E = null>(spec: {
  roles: readonly Role[];
  body?: BodyKind;
  load?: (ctx: MemberCtx) => Promise<E>;
  handle: (ctx: MemberCtx, entity: E) => Promise<Reply>;
}): Endpoint {
  return {
    body: spec.body ?? "json",
    needsSession: true,
    run: async (raw) => {
      const session = raw.session;
      if (session === null) throw unauthenticated();
      const ctx: MemberCtx = { ...raw, session };
      const entity = spec.load ? await spec.load(ctx) : (null as E);
      if (!spec.roles.includes(session.member.role)) throw forbidden();
      checkOrigin(ctx);
      return spec.handle(ctx, entity);
    },
  };
}

interface Route {
  pattern: RegExp;
  keys: string[];
  methods: Partial<Record<string, Endpoint>>;
  headers: Record<string, string>;
}

export class Router {
  private readonly routes: Route[] = [];

  add(path: string, methods: Partial<Record<string, Endpoint>>, headers: Record<string, string> = {}): void {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key: string) => { keys.push(key); return "([^/]+)"; })}$`);
    this.routes.push({ pattern, keys, methods, headers });
  }

  /** Answers the request when a route claims its path; returns false otherwise. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const route = this.routes.find((r) => r.pattern.test(url.pathname));
    if (!route) return false;
    let reply: Reply;
    try {
      reply = await this.dispatch(route, req, url);
    } catch (error) {
      reply = errorReply(error);
    }
    send(res, { ...reply, headers: { ...route.headers, ...reply.headers } });
    return true;
  }

  private async dispatch(route: Route, req: IncomingMessage, url: URL): Promise<Reply> {
    const method = req.method ?? "GET";
    const endpoint = route.methods[method];
    if (!endpoint) {
      for await (const chunk of req) void chunk;
      throw new ApiError(405, "method_not_allowed", `${method} is not supported here.`);
    }
    const { json, upload } = await readBody(req, method === "GET" ? "none" : endpoint.body);
    const session = await currentSession(req);
    if (endpoint.needsSession && session === null) throw unauthenticated();
    const match = route.pattern.exec(url.pathname);
    const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeSegment(match?.[i + 1] ?? "")]));
    return endpoint.run({ req, url, params, body: json, upload, session });
  }
}

/** A path segment as text; a malformed escape can never name a record. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw notFound();
  }
}

export function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) return { status: error.status, json: error.body() };
  console.error(error);
  return { status: 500, json: new ApiError(500, "internal_error", "Something went wrong on our side. Nothing was saved.").body() };
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", ...reply.headers };
  let payload: Buffer | string | undefined = reply.body;
  if (reply.json !== undefined) {
    payload = JSON.stringify(reply.json);
    headers["Content-Type"] = "application/json; charset=utf-8";
  }
  if (payload !== undefined) headers["Content-Length"] = String(Buffer.byteLength(payload));
  res.writeHead(reply.status, headers);
  res.end(payload);
}

