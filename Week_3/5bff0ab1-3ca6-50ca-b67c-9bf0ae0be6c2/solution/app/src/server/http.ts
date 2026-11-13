import type { IncomingMessage, ServerResponse } from "node:http";
import { ANONYMOUS, callerOf, type Caller, type UserRow } from "./auth.js";
import { now } from "./core.js";
import { isConnectionError } from "./db.js";
import { ApiError, errorBody, fail } from "./errors.js";

const BODY_LIMIT = 16_384;

/** A request body read as a JSON object, or null when it is anything else. */
export const jsonObject = (body: unknown): Record<string, unknown> | null => (body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null);

type Reply = { status: number; json?: unknown; bytes?: Buffer; type?: string; headers?: Record<string, string | string[]> };
type Access = "public" | "rider" | "host" | "signed";

type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The parsed JSON body, or undefined when it was empty or not JSON: every handler judges it at its own step. */
  body: unknown;
  caller: Caller;
  user: UserRow;
  now: number;
};

export type Route = {
  method: string;
  path: string;
  access: Access;
  /** Answers without Postgres, so it works whatever the providers are doing. */
  offline?: boolean;
  handler: (ctx: Context) => Promise<Reply>;
};

const compile = (path: string): RegExp => new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);

export function createRouter(routes: Route[]): (method: string, pathname: string) => { route?: Route; params: Record<string, string>; allow: string[] } | null {
  const patterns = routes.map((r) => ({ route: r, regex: compile(r.path) }));
  return (method, pathname) => {
    const matches = patterns.filter((p) => p.regex.test(pathname));
    if (matches.length === 0) return null;
    const hit = matches.find((m) => m.route.method === method);
    const params = { ...((hit ?? matches[0])?.regex.exec(pathname)?.groups ?? {}) };
    return { route: hit?.route, params, allow: matches.map((m) => m.route.method) };
  };
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.json !== undefined) {
    const text = JSON.stringify(reply.json);
    res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    res.end(text);
  } else {
    if (reply.type) headers["Content-Type"] = reply.type;
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
  }
}

export const sendError = (res: ServerResponse, error: ApiError, headers?: Record<string, string>): void => send(res, { status: error.status, json: errorBody(error.code), headers });

/** Reads a JSON body of at most 16,384 bytes: too large is 413 and a body that is not JSON is 415, before anything else. */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > BODY_LIMIT) throw fail("too_large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw fail("too_large");
    chunks.push(chunk as Buffer);
  }
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (size === 0) {
    if (type !== "" && type !== "application/json") throw fail("unsupported_media_type");
    return undefined;
  }
  if (type !== "application/json") throw fail("unsupported_media_type");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, match: NonNullable<ReturnType<ReturnType<typeof createRouter>>>, testSurface: boolean): Promise<void> {
  try {
    const { route, params, allow } = match;
    if (!route) {
      sendError(res, fail("method_not_allowed"), { Allow: [...new Set(allow)].join(", ") });
      return;
    }
    if (route.path.startsWith("/api/test/") && !testSurface) throw fail("not_found");
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const at = route.offline ? 0 : await now();
    const caller = route.offline ? ANONYMOUS : await callerOf(req.headers.cookie, at);
    if (route.access !== "public" && !caller.user) throw fail(caller.ended ? "session_ended" : "unauthenticated");
    if (route.access === "rider" && caller.user?.role !== "rider") throw fail("forbidden");
    if (route.access === "host" && caller.user?.role !== "hub_host") throw fail("forbidden");
    const ctx = { req, res, params, query: url.searchParams, body, caller, user: caller.user as UserRow, now: at };
    const reply = await route.handler(ctx);
    if (!res.headersSent) send(res, reply);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) sendError(res, error);
    else if (isConnectionError(error)) sendError(res, fail("database_unreachable"));
    else {
      console.error(error);
      sendError(res, fail("internal_error"));
    }
  }
}
