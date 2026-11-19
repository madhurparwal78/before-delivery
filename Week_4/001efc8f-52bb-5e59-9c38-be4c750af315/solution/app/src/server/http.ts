import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { now } from "./clock.js";
import { ApiError, invalid } from "./errors.js";
import { one, pool } from "./db.js";
import type { Role } from "./domain/roles.js";

const JSON_LIMIT = 64_000;
const MULTIPART_LIMIT = 41_000_000;
const SESSION_COOKIE = "rw_session";

export type Viewer = {
  id: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
  status: "active";
  sessionHash: string;
  workspace: { id: string; name: string; time_zone: string };
};

export type Part = { name: string; filename: string | null; data: Buffer };
export type Body =
  | { kind: "none" }
  | { kind: "json"; value: unknown }
  | { kind: "multipart"; parts: Part[] };

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: Body;
};
export type AuthedCtx = Ctx & { viewer: Viewer };

export type Reply =
  | { kind: "json"; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: "bytes"; status: number; body: Buffer; headers: Record<string, string> }
  | { kind: "empty"; status: number; headers?: Record<string, string> }
  | { kind: "taken" };

type Handler<C> = (ctx: C) => Promise<Reply>;
type Route =
  | { method: string; pattern: RegExp; keys: string[]; auth: true; multipart: boolean; handler: Handler<AuthedCtx> }
  | { method: string; pattern: RegExp; keys: string[]; auth: false; multipart: boolean; handler: Handler<Ctx> };

const routes: Route[] = [];

function compile(template: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = template.replace(/:(\w+)/g, (_match, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function route(method: string, template: string, handler: Handler<AuthedCtx>, options: { multipart?: boolean } = {}): void {
  routes.push({ method, ...compile(template), auth: true, multipart: options.multipart ?? false, handler });
}

export function publicRoute(method: string, template: string, handler: Handler<Ctx>): void {
  routes.push({ method, ...compile(template), auth: false, multipart: false, handler });
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({ kind: "json", status, body, headers });
export const empty = (status = 204, headers?: Record<string, string>): Reply => ({ kind: "empty", status, headers });

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookies(req: IncomingMessage): Map<string, string> {
  const found = new Map<string, string>();
  for (const piece of (req.headers.cookie ?? "").split(";")) {
    const at = piece.indexOf("=");
    if (at > 0) found.set(piece.slice(0, at).trim(), decodeURIComponent(piece.slice(at + 1).trim()));
  }
  return found;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

async function viewerFor(req: IncomingMessage): Promise<Viewer | null> {
  const token = cookies(req).get(SESSION_COOKIE);
  if (!token) return null;
  const sessionHash = hashToken(token);
  const row = await one<Viewer & { workspace_name: string; time_zone: string; workspace_id: string }>(
    pool,
    `SELECT u.id, u.name, u.handle, u.email, u.role, u.status, u.workspace_id, w.name AS workspace_name, w.time_zone
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN workspaces w ON w.id = u.workspace_id
      WHERE s.token_hash = $1 AND u.status = 'active'`,
    [sessionHash],
  );
  if (!row) return null;
  return {
    id: row.id, name: row.name, handle: row.handle, email: row.email, role: row.role, status: "active", sessionHash,
    workspace: { id: row.workspace_id, name: row.workspace_name, time_zone: row.time_zone },
  };
}

function contentType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    if (req.readableEnded) return resolve();
    req.on("end", resolve);
    req.on("error", () => resolve());
    req.on("close", () => resolve());
    req.resume();
  });
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      await drain(req);
      throw new ApiError("payload_too_large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(raw: Buffer, header: string): Part[] {
  const boundary = /boundary="?([^";]+)"?/i.exec(header)?.[1];
  if (!boundary) throw invalid({});
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];
  let start = raw.indexOf(delimiter);
  while (start !== -1) {
    const afterDelimiter = start + delimiter.length;
    if (raw.subarray(afterDelimiter, afterDelimiter + 2).toString() === "--") break;
    const headerEnd = raw.indexOf("\r\n\r\n", afterDelimiter);
    const next = raw.indexOf(delimiter, afterDelimiter);
    if (headerEnd === -1 || next === -1) break;
    const headers = raw.subarray(afterDelimiter, headerEnd).toString("utf8");
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    if (name !== undefined) parts.push({ name, filename, data: raw.subarray(headerEnd + 4, next - 2) });
    start = next;
  }
  return parts;
}

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const shell = pathname === "/" || /^\/c\/[^/]+$/.test(pathname) || /^\/join\/[^/]+$/.test(pathname);
  const file = shell ? "index.html" : /^\/assets\/[\w.-]+\.(js|css|woff2|woff|svg)$/.test(pathname) ? pathname.slice(1) : null;
  if (file === null) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  try {
    const data = await readFile(path.join(WEB_ROOT, file));
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": shell ? "no-cache" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    }).end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

function send(res: ServerResponse, reply: Reply): void {
  if (reply.kind === "taken") return;
  if (reply.kind === "json") {
    res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", ...reply.headers }).end(JSON.stringify(reply.body));
  } else if (reply.kind === "bytes") {
    res.writeHead(reply.status, reply.headers).end(reply.body);
  } else {
    res.writeHead(reply.status, reply.headers).end();
  }
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host.toLowerCase() === (req.headers.host ?? "").toLowerCase();
  } catch {
    return false;
  }
}

async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<Reply> {
  const method = req.method ?? "GET";
  const match = routes
    .filter((r) => r.method === method)
    .map((r) => ({ r, m: r.pattern.exec(url.pathname) }))
    .find((x) => x.m !== null);
  const carriesBody = method === "POST" || method === "PATCH";
  const type = contentType(req);
  const multipart = type === "multipart/form-data";
  const declared = Number(req.headers["content-length"] ?? "0");
  if (carriesBody && declared > (multipart ? MULTIPART_LIMIT : JSON_LIMIT)) {
    await drain(req);
    throw new ApiError("payload_too_large");
  }
  if (carriesBody && type !== "application/json" && !(multipart && match?.r.multipart)) {
    await drain(req);
    throw new ApiError("unsupported_media_type");
  }
  if ((carriesBody || method === "DELETE") && !sameOrigin(req)) {
    await drain(req);
    throw new ApiError("cross_origin");
  }
  if (!match || !match.m) {
    await drain(req);
    throw new ApiError("not_found");
  }
  const params: Record<string, string> = {};
  match.r.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match.m?.[index + 1] ?? "");
  });
  const viewer = match.r.auth ? await viewerFor(req) : null;
  if (match.r.auth && !viewer) {
    await drain(req);
    throw new ApiError("unauthenticated");
  }
  let body: Body = { kind: "none" };
  if (carriesBody) {
    const raw = await readBody(req, multipart ? MULTIPART_LIMIT : JSON_LIMIT);
    if (multipart) {
      body = { kind: "multipart", parts: parseMultipart(raw, req.headers["content-type"] ?? "") };
    } else {
      try {
        body = { kind: "json", value: raw.length === 0 ? {} : (JSON.parse(raw.toString("utf8")) as unknown) };
      } catch {
        throw invalid({});
      }
    }
  } else {
    await drain(req);
  }
  const ctx: Ctx = { req, res, url, params, body };
  return match.r.auth && viewer ? match.r.handler({ ...ctx, viewer }) : (match.r as Extract<Route, { auth: false }>).handler(ctx);
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Date", now().toUTCString());
  const url = new URL(req.url ?? "/", "http://rimewire.invalid");
  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
    await drain(req);
    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(url.pathname, res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    }
    return;
  }
  try {
    send(res, await dispatch(req, res, url));
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      send(res, json(error.status, error.body, error.headers));
      return;
    }
    const code = error instanceof Error ? ((error as Error & { code?: string }).code ?? error.name) : "unknown";
    console.error(`internal error on ${req.method} ${url.pathname}: ${code}`);
    const internal = new ApiError("internal_error");
    send(res, json(internal.status, internal.body));
  }
}
