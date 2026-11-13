import type { IncomingMessage, ServerResponse } from "node:http";
import { accountOf } from "./auth.js";
import { asApiError, isReady, ping } from "./db.js";
import { ApiError, notFound, unavailable } from "./errors.js";
import { json, match, readJson, readUpload, send, sourceAddress, type Ctx, type Reply } from "./http.js";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function foreignOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || !UNSAFE.has(req.method ?? "")) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

export function errorReply(error: unknown): Reply {
  const known = asApiError(error);
  if (known) return { status: known.status, body: known.body(), headers: known.headers };
  console.error(error);
  return json(500, { error: "internal", message: "Something went wrong on our side." });
}

/** The whole-API order: origin, limit, body, sign-in, role, then the handler (which finds, conflicts, then validates). */
export async function dispatchApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  let settle: ((failed: boolean) => void) | undefined;
  let failed = false;
  try {
    if (url.pathname === "/api/health" && method === "GET") {
      const up = isReady() && (await ping());
      send(res, json(up ? 200 : 503, { status: up ? "ok" : "unavailable" }, { "cache-control": "no-store" }));
      return;
    }
    if (foreignOrigin(req)) throw new ApiError(403, "bad_origin", "That request came from another origin.");
    const found = match(method === "HEAD" ? "GET" : method, url.pathname);
    if (!found) throw notFound();
    if (!isReady()) throw unavailable();
    const { route, params } = found;
    const ctx: Ctx = { req, res, url, params, ip: sourceAddress(req), body: undefined, upload: null, account: null };
    settle = route.guard?.(ctx) ?? undefined;
    if (route.body === "json") ctx.body = await readJson(req);
    else if (route.body === "upload") ctx.upload = await readUpload(req);
    if (route.auth !== "public") {
      ctx.account = await accountOf(req);
      if (!ctx.account) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
      if (route.auth !== "any" && ctx.account.role !== route.auth)
        throw new ApiError(403, "forbidden", "Your account can't do that.");
    }
    const reply = await route.handler(ctx);
    reply.headers = { "cache-control": "no-store", ...reply.headers };
    send(res, reply);
  } catch (error) {
    failed = error instanceof ApiError && error.code === "bad_credentials";
    const reply = errorReply(error);
    reply.headers = { "cache-control": "no-store", ...reply.headers };
    send(res, reply);
  } finally {
    settle?.(failed);
  }
}
