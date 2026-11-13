import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHUNK_BYTES, JSON_BYTES_MAX, SRT_BYTES_MAX } from "../shared/limits";
import type { Actor } from "./access";
import { sessionFromCookie, type Session } from "./auth";
import { AppError } from "./errors";
import { isOwnOrigin } from "./origin";
import { authenticateToken } from "./tokens";
import { StorageDown } from "./s3";

export type BodyKind = "json" | "octet" | "srt" | "none";
export type AuthKind = "public" | "session" | "owner" | "token";

const BODY_RULES: Record<Exclude<BodyKind, "none">, { limit: number; type: RegExp; label: string }> = {
  json: { limit: JSON_BYTES_MAX, type: /^application\/json(\s*;.*)?$/i, label: "application/json; charset=utf-8" },
  octet: { limit: CHUNK_BYTES, type: /^application\/octet-stream$/i, label: "application/octet-stream" },
  srt: { limit: SRT_BYTES_MAX, type: /^application\/x-subrip(\s*;.*)?$/i, label: "application/x-subrip" },
};

export interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  json: unknown;
  raw: Buffer;
  session: Session | null;
  actor: Actor;
  request: http.IncomingMessage;
}

export interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer;
  type?: string;
  headers?: Record<string, string>;
}

export interface Route {
  method: string;
  segments: string[];
  auth: AuthKind;
  body: BodyKind;
  handler: (ctx: Ctx) => Promise<Reply>;
}

const NONE: Actor = { id: "", name: "", email: "", handle: "", is_owner: false };

export const json = (body: unknown, status = 200, headers?: Record<string, string>): Reply => ({ status, body, ...(headers ? { headers } : {}) });
export const empty = (status = 204, headers?: Record<string, string>): Reply => ({ status, ...(headers ? { headers } : {}) });

function match(route: Route, parts: string[]): Record<string, string> | null {
  if (route.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, segment] of route.segments.entries()) {
    const part = parts[index] ?? "";
    if (segment.startsWith(":")) params[segment.slice(1)] = part;
    else if (segment !== part) return null;
  }
  return params;
}

async function readBody(request: http.IncomingMessage, limit: number): Promise<Buffer> {
  const length = request.headers["content-length"];
  if (length !== undefined && Number(length) > limit) throw new AppError("too_large", { limit });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > limit) throw new AppError("too_large", { limit });
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function hasBody(request: http.IncomingMessage): boolean {
  const length = request.headers["content-length"];
  return request.headers["transfer-encoding"] !== undefined || (length !== undefined && Number(length) > 0);
}

/** Applies the boundary in the published order: routing, size, type, origin, then the caller's identity. */
export async function dispatch(routes: readonly Route[], request: http.IncomingMessage): Promise<Reply> {
  const url = new URL(request.url ?? "/", "http://local");
  const parts = url.pathname.split("/").filter(Boolean);
  const candidates = routes.flatMap((route) => {
    const params = match(route, parts);
    return params ? [{ route, params }] : [];
  });
  if (!candidates.length) throw new AppError("not_found");
  const method = request.method ?? "GET";
  const chosen = candidates.find((candidate) => candidate.route.method === method);
  if (!chosen) {
    throw new AppError("method_not_allowed", {}, {}, { allow: [...new Set(candidates.map((candidate) => candidate.route.method))].join(", ") });
  }
  const { route, params } = chosen;
  let raw: Buffer = Buffer.alloc(0);
  if (route.body === "none") {
    if (hasBody(request)) raw = await readBody(request, JSON_BYTES_MAX);
  } else {
    const rule = BODY_RULES[route.body];
    if (hasBody(request)) {
      const length = request.headers["content-length"];
      if (length !== undefined && Number(length) > rule.limit) throw new AppError("too_large", { limit: rule.limit });
      if (!rule.type.test((request.headers["content-type"] ?? "").trim())) throw new AppError("unsupported_media_type", { expected: rule.label });
    }
  }
  if (!isOwnOrigin(request.headers.origin, request.headers.host) && method !== "GET" && method !== "HEAD") throw new AppError("forbidden");
  if (route.body !== "none" && hasBody(request)) raw = await readBody(request, BODY_RULES[route.body].limit);

  let session: Session | null = null;
  if (route.auth === "token") {
    await authenticateToken(request.headers.authorization);
  } else if (route.auth !== "public") {
    session = await sessionFromCookie(request.headers.cookie);
    if (!session) throw new AppError("unauthenticated");
    if (route.auth === "owner" && !session.actor.is_owner) throw new AppError("forbidden");
  }
  let parsed: unknown = undefined;
  if (route.body === "json" && raw.length) {
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      parsed = undefined;
    }
  }
  return route.handler({ params, query: url.searchParams, json: parsed, raw, session, actor: session?.actor ?? NONE, request });
}

export function send(response: http.ServerResponse, reply: Reply, head = false): void {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...reply.headers,
  };
  if (reply.raw !== undefined) {
    headers["content-type"] = reply.type ?? "application/octet-stream";
    response.writeHead(reply.status, { ...headers, "content-length": String(reply.raw.length) });
    response.end(head ? undefined : reply.raw);
  } else if (reply.body !== undefined) {
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    headers["content-type"] = "application/json; charset=utf-8";
    response.writeHead(reply.status, { ...headers, "content-length": String(Buffer.byteLength(text)) });
    response.end(head ? undefined : text);
  } else {
    response.writeHead(reply.status, headers);
    response.end();
  }
}

export function errorReply(error: unknown): Reply {
  if (error instanceof AppError) return { status: error.status, body: error.body(), headers: error.headers };
  if ((error as { code?: string }).code === "23503") {
    const missing = new AppError("not_found");
    return { status: missing.status, body: missing.body() };
  }
  if (error instanceof StorageDown) {
    const mapped = new AppError("storage_unavailable");
    return { status: mapped.status, body: mapped.body() };
  }
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  const internal = new AppError("internal");
  return { status: internal.status, body: internal.body() };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "client");
const PAGES = [/^\/$/, /^\/sign-in$/, /^\/library$/, /^\/profile$/, /^\/projects\/[^/]+$/, /^\/review\/[^/]+$/];

/** Built static files, and the app shell for the published pages; everything else is the shell's 404. */
export async function serveStatic(request: http.IncomingMessage): Promise<Reply> {
  const pathname = new URL(request.url ?? "/", "http://local").pathname;
  if (pathname.startsWith("/assets/")) {
    const file = path.join(clientDir, pathname);
    if (file.startsWith(clientDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return {
        status: 200,
        raw: fs.readFileSync(file),
        type: TYPES[path.extname(file)] ?? "application/octet-stream",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      };
    }
  }
  const page = PAGES.some((pattern) => pattern.test(pathname));
  if (page && pathname !== "/sign-in" && !pathname.startsWith("/review/")) {
    const session = await sessionFromCookie(request.headers.cookie);
    if (!session) return { status: 302, headers: { location: "/sign-in" } };
  }
  const shell = path.join(clientDir, "index.html");
  return { status: page ? 200 : 404, raw: fs.readFileSync(shell), type: TYPES[".html"], headers: { "cache-control": "no-cache" } };
}
