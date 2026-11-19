import { IncomingMessage, ServerResponse } from "node:http";
import { RequestError, ErrorCode } from "../../shared/errors.js";

/**
 * The server boundary (DP-88): same-origin only, body-size and content-type
 * limits, and the one error shape for every refusal.
 */

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  body: Buffer;
  params: Record<string, string>;
}

export type Handler = (ctx: RouteContext) => Promise<unknown> | unknown;

export interface Route {
  method: string;
  /** Path pattern with :name segments. */
  pattern: string;
  handler: Handler;
  /** Requests with a body must send application/json unless raw is set. */
  raw?: boolean;
}

export const BODY_LIMIT_JSON = 1_000_000;
export const BODY_LIMIT_GRADING = 10_000_000;
export const BODY_LIMIT_FILE = 5_000_000;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof RequestError) {
    sendJson(res, err.status, err.body);
    return;
  }
  sendJson(res, 500, { error: "internal" as ErrorCode });
  // surfaced in the server log, never sent to the browser
  console.error("internal error:", err);
}

/** A handler result that carries its own status. */
export interface StatusResult { status: number; body: unknown }
export function status(status: number, body: unknown): StatusResult {
  return { status, body };
}

/** Marks a handler that wrote its own response (streams and files). */
export const RAW_RESPONSE = Symbol("raw-response");

export function matchRoute(routes: Route[], path: string, method?: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const routeParts = route.pattern.split("/");
    const pathParts = path.split("/");
    if (routeParts.length !== pathParts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < routeParts.length; i++) {
      const rp = routeParts[i];
      if (rp.startsWith(":")) params[rp.slice(1)] = decodeURIComponent(pathParts[i]);
      else if (rp !== pathParts[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (method === undefined || route.method === method) return { route, params };
  }
  return null;
}

/** Parse a JSON body with the single limit and content-type rules. */
export function readJsonBody(ctx: RouteContext, limit: number): unknown {
  if (ctx.body.length > limit) {
    throw new RequestError("too_large", 413, { limit });
  }
  if (ctx.body.length === 0) return undefined;
  const contentType = ctx.req.headers["content-type"] ?? "";
  const isJson = contentType.toLowerCase().startsWith("application/json");
  if (!isJson) {
    throw new RequestError("unsupported_media_type", 415);
  }
  try {
    return JSON.parse(ctx.body.toString("utf8"));
  } catch {
    throw new RequestError("invalid_body", 400);
  }
}
