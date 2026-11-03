// The HTTP boundary: routing, same-origin and size rules, JSON bodies, sessions and the built browser app.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isReady, one } from "./db.js";
import { ApiError } from "./errors.js";
import { type Me, toMe } from "./users.js";

export const SESSION_COOKIE = "pc_session";
const BODY_LIMIT = 16 * 1024;
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

type Access = "public" | "session" | "verified";

interface Context {
  method: string;
  params: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
  me: Me | null;
  sessionHash: string | null;
  req: IncomingMessage;
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
}

interface SignedIn extends Context {
  me: Me;
}

interface Route {
  method: string;
  pattern: RegExp;
  access: Access;
  limit: number;
  handle: (context: Context) => Promise<Reply>;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, access: "public", handle: (context: Context) => Promise<Reply>, limit?: number): void;
export function route(method: string, pattern: string, access: "session" | "verified", handle: (context: SignedIn) => Promise<Reply>, limit?: number): void;
export function route(method: string, pattern: string, access: Access, handle: (context: SignedIn) => Promise<Reply>, limit = BODY_LIMIT): void {
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, "([^/]+)")}$`);
  routes.push({
    method, pattern: regex, access, limit,
    handle: (context) => {
      if (access !== "public" && context.me === null) throw new ApiError("unauthenticated");
      return handle(context as SignedIn);
    },
  });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function sessionUser(req: IncomingMessage): Promise<{ me: Me; hash: string } | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token === null || token === "") return null;
  const hash = hashToken(token);
  const row = await one(
    "SELECT u.id, u.handle, u.email, u.email_verified FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [hash],
  );
  return row === undefined ? null : { me: toMe(row), hash };
}

// A request's Origin, when present, must be this server's own origin.
export function sameOrigin(req: IncomingMessage, publicUrl: string): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host || parsed.origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  res.writeHead(reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function sendError(res: ServerResponse, error: ApiError): void {
  send(res, { status: error.status, body: error.body(), headers: error.headers });
}

async function readBody(req: IncomingMessage, limit: number): Promise<{ raw: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size <= limit) chunks.push(buffer);
  }
  return { raw: Buffer.concat(chunks), tooLarge: size > limit };
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, publicUrl: string): Promise<void> {
  const method = req.method ?? "GET";
  if (url.pathname === "/api/health") {
    send(res, isReady() ? { status: 200, body: { status: "ok" } } : { status: 503, body: { status: "starting" } });
    return;
  }
  let params: string[] = [];
  const found = routes.find((candidate) => {
    if (candidate.method !== method) return false;
    const match = candidate.pattern.exec(url.pathname);
    if (match === null) return false;
    params = match.slice(1).map((value) => decodeURIComponent(value));
    return true;
  });
  if (STATE_CHANGING.has(method) && !sameOrigin(req, publicUrl)) throw new ApiError("bad_origin");
  const { raw, tooLarge } = await readBody(req, found?.limit ?? BODY_LIMIT);
  if (found === undefined) throw new ApiError("not_found");
  if (tooLarge) throw new ApiError("payload_too_large");
  let body: Record<string, unknown> = {};
  if (raw.length > 0) {
    const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") throw new ApiError("unsupported_media_type");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new ApiError("validation_failed", { fields: {} });
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ApiError("validation_failed", { fields: {} });
    body = parsed as Record<string, unknown>;
  }
  if (!isReady()) throw new ApiError("starting");
  const session = await sessionUser(req);
  if (found.access === "verified" && session !== null && !session.me.emailVerified) throw new ApiError("email_unverified");
  const reply = await found.handle({
    method, params, query: url.searchParams, body, me: session?.me ?? null, sessionHash: session?.hash ?? null, req,
  });
  send(res, reply);
}

// Source, source maps, .env files, package manifests, lockfiles, node_modules and run.json are never served.
const FORBIDDEN_FILES = new Set(["package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "run.json"]);
const FORBIDDEN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".map"]);

function isForbidden(pathname: string): boolean {
  const segments = pathname.toLowerCase().split("/");
  const last = segments[segments.length - 1] ?? "";
  return segments.includes("node_modules") || FORBIDDEN_FILES.has(last) || last === ".env" || last.startsWith(".env.")
    || FORBIDDEN_EXTENSIONS.has(path.posix.extname(last));
}

// Built assets are served as files; forbidden paths get the app's 404; every other path gets the shell for client routes.
async function handleStatic(res: ServerResponse, pathname: string): Promise<void> {
  const shell = path.join(PUBLIC_DIR, "index.html");
  let file = shell;
  let status = 200;
  if (isForbidden(pathname)) status = 404;
  else {
    const candidate = path.resolve(PUBLIC_DIR, `.${path.posix.normalize(pathname)}`);
    const inside = candidate.startsWith(`${PUBLIC_DIR}${path.sep}`);
    const exists = inside && path.extname(candidate) in TYPES && (await stat(candidate).then((s) => s.isFile(), () => false));
    if (exists) file = candidate;
  }
  const content = await readFile(file);
  const type = TYPES[path.extname(file)] ?? "application/octet-stream";
  const caching = file === shell ? "no-cache" : "public, max-age=3600";
  res.writeHead(status, { "Content-Type": type, "Cache-Control": caching, "X-Content-Type-Options": "nosniff" });
  res.end(content);
}

export function requestHandler(publicUrl: string): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://app.invalid");
    const work = url.pathname === "/api" || url.pathname.startsWith("/api/")
      ? handleApi(req, res, url, publicUrl)
      : handleStatic(res, url.pathname);
    work.catch((error: unknown) => {
      const apiError = error instanceof ApiError ? error : new ApiError("internal");
      if (!(error instanceof ApiError)) console.error(error);
      if (res.headersSent) res.end();
      else sendError(res, apiError);
    });
  };
}
