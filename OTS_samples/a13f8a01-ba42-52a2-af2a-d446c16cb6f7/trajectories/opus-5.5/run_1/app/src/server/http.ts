import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, validation } from "./errors";
import type { UserRow } from "./auth";

export type Reply =
  | { kind: "json"; status: number; body: unknown; headers?: Record<string, string | string[]> }
  | { kind: "empty"; status: number; headers?: Record<string, string | string[]> }
  | { kind: "raw"; status: number; body: Buffer | string; headers: Record<string, string> }
  | { kind: "handled" };

export function json(status: number, body: unknown, headers?: Record<string, string | string[]>): Reply {
  return headers ? { kind: "json", status, body, headers } : { kind: "json", status, body };
}

export function empty(status: number, headers?: Record<string, string | string[]>): Reply {
  return headers ? { kind: "empty", status, headers } : { kind: "empty", status };
}

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  rawBody: Buffer;
  sessionToken: string | null;
  user: UserRow | null;
}

export function requireUser(ctx: Context): UserRow {
  if (!ctx.user) throw new ApiError("not_signed_in");
  return ctx.user;
}

export type JsonObject = Record<string, unknown>;

export function readJson(ctx: Context): JsonObject {
  if (ctx.rawBody.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.rawBody.toString("utf8"));
  } catch {
    throw validation({ body: "The body must be JSON." });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw validation({ body: "The body must be a JSON object." });
  return parsed as JsonObject;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too_large"> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > limit) {
      req.resume();
      resolve("too_large");
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? "too_large" : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function writeReply(res: ServerResponse, reply: Reply, baseHeaders: Record<string, string>): void {
  if (reply.kind === "handled") return;
  for (const [name, value] of Object.entries(baseHeaders)) res.setHeader(name, value);
  if (reply.kind !== "raw") res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
  if (reply.kind === "json") {
    const body = Buffer.from(JSON.stringify(reply.body), "utf8");
    res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
    res.end(body);
  } else if (reply.kind === "empty") {
    res.writeHead(reply.status);
    res.end();
  } else {
    const body = typeof reply.body === "string" ? Buffer.from(reply.body, "utf8") : reply.body;
    res.writeHead(reply.status, { "Content-Length": body.length });
    res.end(body);
  }
}

export type Handler = (ctx: Context) => Promise<Reply>;

export interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

export function route(method: string, path: string, handler: Handler): Route {
  const source = path.replace(/:[a-z]+/g, "([^/]+)");
  return { method, pattern: new RegExp(`^${source}$`), handler };
}

export function matchRoute(routes: readonly Route[], method: string, pathname: string): { route: Route; params: string[] } | null {
  const effective = method === "HEAD" ? "GET" : method;
  for (const candidate of routes) {
    if (candidate.method !== effective) continue;
    const match = candidate.pattern.exec(pathname);
    if (match) return { route: candidate, params: match.slice(1).map((part) => decodeURIComponent(part)) };
  }
  return null;
}
