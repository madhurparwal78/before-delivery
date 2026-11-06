import { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "./errors";
import { isStateChanging, JSON_BODY_LIMIT, MULTIPART_BODY_LIMIT, ParsedBody, ParsedMultipart, parseMultipart, readBody, sendJson } from "./httpio";

export type RouteMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: RouteMethod;
  path: string;
  query: URLSearchParams;
  /** Present only for routes declared with body: "json" | "multipart" | "raw". */
  body: ParsedBody | null;
  session: SessionUser | null;
  params: Record<string, string>;
  idempotencyKey: string | null;
}

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: string;
  initials: string | null;
  orgCode: string | null;
  sessionToken: string;
}

interface Route {
  method: RouteMethod;
  pattern: string; // e.g. /api/assignments/:number
  bodyKind: "json" | "multipart" | "none" | "raw";
  roles: readonly string[] | "any" | "signed-out-or-in";
  handler: (ctx: Ctx) => Promise<void>;
}

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

export class Router {
  private routes: Route[] = [];

  add(
    method: RouteMethod,
    pattern: string,
    opts: {
      body?: "json" | "multipart" | "raw";
      roles?: readonly string[] | "any";
      handler: (ctx: Ctx) => Promise<void>;
    },
  ): void {
    this.routes.push({
      method,
      pattern,
      bodyKind: opts.body ?? "none",
      roles: opts.roles ?? "any",
      handler: opts.handler,
    });
  }

  private match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const routeParts = route.pattern.split("/");
      const pathParts = path.split("/");
      if (routeParts.length !== pathParts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < routeParts.length; i++) {
        const rp = routeParts[i];
        if (rp.startsWith(":")) {
          params[rp.slice(1)] = decodeURIComponent(pathParts[i]);
        } else if (rp !== pathParts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  async dispatch(req: IncomingMessage, res: ServerResponse, session: SessionUser | null): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method === "HEAD" ? "GET" : (req.method as string);
    const matched = this.match(method, path);
    if (!matched) return false;
    const { route, params } = matched;
    const ctx: Ctx = {
      req,
      res,
      method: method as RouteMethod,
      path,
      query: url.searchParams,
      body: null,
      session,
      params,
      idempotencyKey: null,
    };
    try {
      // 1. cross-origin writes
      if (isStateChanging(method) && req.headers.origin) {
        const host = req.headers.host ?? "";
        let originHost: string | null = null;
        try {
          originHost = new URL(req.headers.origin ?? "").host;
        } catch {
          originHost = null;
        }
        if (originHost !== host) throw new ApiError("cross_origin", "Cross-origin writes are refused.");
      }
      // 3. session
      const needsAuth = route.roles !== "any";
      if (needsAuth && !session) throw new ApiError("unauthenticated", "Sign in first.");
      // 4. routes whose role list excludes the caller are invisible to them.
      if (needsAuth && session && !(route.roles as readonly string[]).includes(session.role)) {
        throw new ApiError("not_found", "Not found.");
      }
      // 2. body size + content type
      if (route.bodyKind === "json") {
        const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (ct !== "application/json") throw new ApiError("unsupported_media_type", "Send application/json.");
        const raw = await readBody(req, JSON_BODY_LIMIT + 1);
        if (raw.length > JSON_BODY_LIMIT) throw new ApiError("payload_too_large", "Body too large.");
        ctx.body = { raw, json: raw.length ? JSON.parse(raw.toString("utf8")) : undefined, multipart: undefined };
        if (ctx.body.json !== undefined && (typeof ctx.body.json !== "object" || ctx.body.json === null)) {
          throw new ApiError("unsupported_media_type", "Send a JSON object.");
        }
      } else if (route.bodyKind === "multipart") {
        const ct = req.headers["content-type"] ?? "";
        if (!ct.toLowerCase().startsWith("multipart/form-data")) {
          throw new ApiError("unsupported_media_type", "Send multipart/form-data.");
        }
        const raw = await readBody(req, MULTIPART_BODY_LIMIT + 1);
        if (raw.length > MULTIPART_BODY_LIMIT) throw new ApiError("payload_too_large", "Body too large.");
        ctx.body = { raw, json: undefined, multipart: parseMultipart(raw, ct) as ParsedMultipart };
      } else if (route.bodyKind === "raw") {
        const raw = await readBody(req, JSON_BODY_LIMIT + 1);
        ctx.body = { raw, json: undefined, multipart: undefined };
      }
      // Idempotency key capture (validated by the handler that needs it).
      const ik = req.headers["idempotency-key"];
      if (typeof ik === "string") ctx.idempotencyKey = ik;
      await route.handler(ctx);
      if (!res.writableEnded) sendJson(res, 500, { error: { code: "internal", message: "No response." } });
    } catch (e) {
      if (res.writableEnded) return true;
      if (e instanceof ApiError) {
        sendJson(res, e.status, e.body());
      } else if ((e as { code?: string }).code === "payload_too_large") {
        sendJson(res, 413, { error: { code: "payload_too_large", message: "Body too large." } });
      } else if (e instanceof SyntaxError) {
        sendJson(res, 422, { error: { code: "validation", message: "Check the highlighted fields.", fields: {} } });
      } else {
        const msg = e instanceof Error ? e.message : "Unknown error";
        sendJson(res, 500, { error: { code: "internal", message: msg } });
      }
    }
    return true;
  }
}

export function requireIdempotencyKey(ctx: Ctx): string {
  const key = ctx.idempotencyKey;
  if (typeof key !== "string" || key.length < 1 || key.length > 100 || !PRINTABLE_ASCII.test(key)) {
    throw new ApiError("idempotency_key_required", "Send an Idempotency-Key header (1-100 printable ASCII characters).");
  }
  return key;
}

export function readJson(ctx: Ctx): Record<string, unknown> {
  return (ctx.body?.json as Record<string, unknown> | undefined) ?? {};
}

export function readMultipart(ctx: Ctx): ParsedMultipart {
  return ctx.body?.multipart ?? { fields: new Map(), files: new Map() };
}
