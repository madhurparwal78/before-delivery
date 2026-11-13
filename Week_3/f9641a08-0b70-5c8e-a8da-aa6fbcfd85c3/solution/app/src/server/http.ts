import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { config, publicOrigin } from "./config";
import { createSession, loadSession, type Session, type SessionUser } from "./auth";
import { one, pool } from "./db";
import { ApiError, fail, validation } from "./errors";
import { openStream } from "./live";
import { serveMedia } from "./media";
import { routes, type Route } from "./routes";

export interface Ctx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body (null when the request had none). */
  body: Record<string, unknown>;
  rawBody: Buffer;
  headers: IncomingMessage["headers"];
  form: FormData | null;
  session: Session;
  idempotencyKey: string | null;
  now: Date;
  route: Route;
  /** Signed-in user or a 401. */
  user(): SessionUser;
}

export interface Reply {
  status: number;
  /** A JSON body; or the stored text of a replayed answer. */
  body?: object;
  text?: string;
  contentType?: string;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

const JSON_LIMIT = 1_000_000;
const UPLOAD_OVERHEAD = 100_000;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const COOKIE = "rh_session";

const SECURITY_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };

function send(res: ServerResponse, reply: Reply, extra: Record<string, string> = {}): void {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, "Cache-Control": "no-store", ...extra, ...reply.headers };
  if (reply.bytes) {
    headers["Content-Type"] = reply.contentType ?? "application/octet-stream";
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
    return;
  }
  if (reply.status === 204) {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  headers["Content-Type"] = "application/json; charset=utf-8";
  res.writeHead(reply.status, headers);
  res.end(reply.text ?? JSON.stringify(reply.body ?? {}));
}

function sendError(res: ServerResponse, failure: ApiError, extra: Record<string, string> = {}): void {
  send(res, { status: failure.status, body: failure.body }, extra);
}

function cookieOf(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return null;
}

function setCookie(id: string): string {
  return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

async function readSession(req: IncomingMessage): Promise<Session | null> {
  const id = cookieOf(req);
  return id ? loadSession(pool, id) : null;
}

/** Reads the whole body, refusing anything over `limit` bytes. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | "method" | null {
  let known = false;
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    if (!route.hidden) known = true;
    if (route.method !== method) continue;
    return { route, params: match.groups ?? {} };
  }
  return known ? "method" : null;
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  if (/^\/api\/admin\/audit\/[^/]+$/.test(path)) {
    sendError(res, fail("audit_immutable"));
    return;
  }
  const found = matchRoute(method, path);
  if (found === null) {
    sendError(res, fail("not_found"));
    return;
  }
  if (found === "method") {
    sendError(res, fail("method_not_allowed"));
    return;
  }
  const { route, params } = found;
  const upload = route.upload === true;
  const limit = upload ? config.uploadMaxBytes + UPLOAD_OVERHEAD : JSON_LIMIT;
  let raw: Buffer = Buffer.alloc(0);
  if (WRITES.has(method)) {
    const body = await readBody(req, limit);
    if (body === null) {
      sendError(res, fail("too_large_request"));
      return;
    }
    raw = body;
    const type = (req.headers["content-type"] ?? "").toLowerCase();
    if (raw.length > 0 && !(upload ? type.startsWith("multipart/form-data") : type.startsWith("application/json"))) {
      sendError(res, fail("unsupported_media_type"));
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== publicOrigin) {
      sendError(res, fail("cross_origin"));
      return;
    }
  }

  let session = await readSession(req);
  let cookie: string | null = null;
  if (!session) {
    const id = await createSession(pool, null);
    session = await loadSession(pool, id);
    cookie = setCookie(id);
  }
  if (!session) throw new Error("session was just created");
  const extra: Record<string, string> = cookie ? { "Set-Cookie": cookie } : {};

  let json: Record<string, unknown> = {};
  let form: FormData | null = null;
  if (raw.length > 0) {
    if (upload) {
      form = await new Response(new Uint8Array(raw), { headers: { "Content-Type": req.headers["content-type"] ?? "" } }).formData().catch(() => null);
      if (form === null) {
        sendError(res, validation({ file: "Choose a file to upload." }), extra);
        return;
      }
    } else {
      try {
        const parsed: unknown = JSON.parse(raw.toString("utf8"));
        json = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
      } catch {
        sendError(res, validation({}), extra);
        return;
      }
    }
  }

  const header = req.headers["idempotency-key"];
  const ctx: Ctx = {
    method,
    path,
    params,
    query: url.searchParams,
    body: json,
    rawBody: raw,
    headers: req.headers,
    form,
    session,
    idempotencyKey: typeof header === "string" ? header : null,
    now: new Date(),
    route,
    user() {
      if (!session.user) throw fail("unauthenticated");
      return session.user;
    },
  };

  try {
    if (route.auth === "user" || route.auth === "staff") ctx.user();
    const reply = await route.handler(ctx);
    send(res, reply, extra);
  } catch (failure) {
    if (failure instanceof ApiError) {
      sendError(res, failure, extra);
      return;
    }
    console.error("unhandled", failure instanceof Error ? failure.stack : failure);
    sendError(res, fail("server_error"), extra);
  }
}

// ---- static files and the single-page shell ---------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const ROOT = join(dirname(process.argv[1] ?? "."), "public");
const PAGES = [
  /^\/$/,
  /^\/collections\/(all|luggage|backpacks|totes|wallets|accessories)$/,
  /^\/products\/[^/]+$/,
  /^\/(compare|wishlist|bag|account|sign-in|register|care)$/,
  /^\/checkout\/[^/]+$/,
  /^\/orders\/[^/]+$/,
  /^\/admin(\/[^/]+){0,3}$/,
];

function pipeFile(res: ServerResponse, file: string, status: number, immutable: boolean): void {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
}

/** The page shell carries the live sequence at load, so the stream resumes from the moment the page was opened. */
async function sendShell(res: ServerResponse, status: number): Promise<void> {
  const html = await readFile(join(ROOT, "index.html"), "utf8");
  const seq = (await one<{ seq: number }>(pool, "SELECT seq FROM live_counter WHERE id = 1"))?.seq ?? 0;
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
  res.end(html.replace("</head>", `<meta name="live-after" content="${seq}" /></head>`));
}

async function staticFile(res: ServerResponse, path: string): Promise<void> {
  const file = join(ROOT, normalize(path));
  if (/^\/(assets|fonts)\//.test(path) && file.startsWith(ROOT) && existsSync(file) && statSync(file).isFile()) {
    pipeFile(res, file, 200, true);
    return;
  }
  await sendShell(res, PAGES.some((p) => p.test(path)) ? 200 : 404);
}

export function startServer(): Server {
  const server = createServer((req, res) => {
    handle(req, res).catch((failure) => {
      console.error("request failed", failure instanceof Error ? failure.stack : failure);
      if (!res.headersSent) sendError(res, fail("server_error"));
      else res.end();
    });
  });
  server.requestTimeout = 0;
  server.keepAliveTimeout = 65_000;
  server.listen(config.port, "0.0.0.0");
  return server;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://placeholder");
  const path = url.pathname;
  if (path === "/api/live" && req.method === "GET") {
    const session = await readSession(req);
    const header = req.headers["last-event-id"];
    const raw = typeof header === "string" ? header : url.searchParams.get("after");
    const after = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
    await openStream(req, res, session, after);
    return;
  }
  if (path.startsWith("/api/")) {
    await api(req, res, url);
    return;
  }
  if (path.startsWith("/media/")) {
    await serveMedia(req, res, path);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendError(res, fail("method_not_allowed"));
    return;
  }
  await staticFile(res, path);
}
