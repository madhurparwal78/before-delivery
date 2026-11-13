import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { headerText, type BodyKind, type Context, type Reply, type Route } from "./context";
import { ensureSchema, asDatabaseError, database } from "./db";
import { ApiError, errorBody } from "./errors";
import { parseJson } from "./parse";
import { refuseAfterRate } from "./ratelimit";
import { hasLiveSession, sessionToken } from "./session";
import { ownerRoutes } from "./routes-owner";
import { opsRoutes } from "./routes-ops";

const ROUTES: Route[] = [...ownerRoutes, ...opsRoutes];

const BODY_CAPS: Record<Exclude<BodyKind, "none">, { bytes: number; code: "payload_too_large" | "request_too_large" | "file_too_large" }> = {
  json: { bytes: 64_000, code: "payload_too_large" },
  multipart: { bytes: 33_000_000, code: "request_too_large" },
  csv: { bytes: 2_000_000, code: "file_too_large" },
};

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface Match {
  route: Route;
  params: Record<string, string>;
}

function compile(template: string): RegExp {
  return new RegExp(`^${template.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
}

const COMPILED = ROUTES.map((route) => ({ route, pattern: compile(route.template) }));

function matchRoute(method: string, path: string): { match: Match | null; pathKnown: boolean } {
  let pathKnown = false;
  for (const { route, pattern } of COMPILED) {
    const found = pattern.exec(path);
    if (!found) continue;
    const params: Record<string, string> = {};
    for (const [name, value] of Object.entries(found.groups ?? {})) {
      try {
        params[name] = decodeURIComponent(value);
      } catch {
        params[name] = value;
      }
    }
    // A NUL byte cannot be in any stored text, so no resource has such an id: not found, never a database error.
    if (Object.values(params).some((value) => value.includes("\0"))) return { match: null, pathKnown: false };
    pathKnown = true;
    if (route.method !== method && route.method !== "*") continue;
    return { match: { route, params }, pathKnown };
  }
  return { match: null, pathKnown };
}

// ---- body ------------------------------------------------------------------------------------

/** Reads a request body up to a cap; returns null when it is larger (the rest is read and thrown away). */
function readBody(req: IncomingMessage, cap: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= cap) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > cap ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const isJsonType = (type: string): boolean => /^application\/json\s*(;|$)/i.test(type);

async function loadBody(req: IncomingMessage, kind: BodyKind, method: string): Promise<{ body: Buffer; contentType: string }> {
  const contentType = headerText(req.headers["content-type"]) ?? "";
  if (kind === "none" || !BODY_METHODS.has(method)) return { body: Buffer.alloc(0), contentType };
  const cap = BODY_CAPS[kind];
  const length = Number(headerText(req.headers["content-length"]) ?? "0");
  const hasBody = length > 0 || req.headers["transfer-encoding"] !== undefined;
  if (length > cap.bytes) {
    req.resume();
    throw new ApiError(cap.code);
  }
  const wrongType =
    (kind === "json" && hasBody && !isJsonType(contentType)) ||
    (kind === "multipart" && !/^multipart\/form-data\s*;/i.test(contentType)) ||
    (kind === "csv" && !/^text\/csv\s*(;|$)/i.test(contentType));
  if (wrongType) {
    req.resume();
    throw new ApiError("unsupported_media_type");
  }
  const body = await readBody(req, cap.bytes);
  if (body === null) throw new ApiError(cap.code);
  return { body, contentType };
}

// ---- replies ---------------------------------------------------------------------------------

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "cache-control": "no-store", "x-content-type-options": "nosniff", ...reply.headers };
  let payload: Buffer | undefined;
  if (reply.raw) {
    payload = reply.raw;
    headers["content-type"] = reply.contentType ?? "application/octet-stream";
  } else if (reply.json !== undefined) {
    payload = Buffer.from(JSON.stringify(reply.json));
    headers["content-type"] = "application/json; charset=utf-8";
  }
  if (payload) headers["content-length"] = String(payload.length);
  res.writeHead(reply.status, headers);
  res.end(payload);
}

function errorReply(error: unknown, ops: boolean): Reply {
  const known = asDatabaseError(error);
  const apiError = known instanceof ApiError ? known : new ApiError("internal_error");
  if (!(known instanceof ApiError)) process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  const headers: Record<string, string> = {};
  if (apiError.detail.retryAfter !== undefined) headers["retry-after"] = String(apiError.detail.retryAfter);
  return { status: apiError.status, json: errorBody(apiError, ops), headers };
}

// ---- API pipeline ----------------------------------------------------------------------------

function refuseForeignOrigin(req: IncomingMessage): void {
  const origin = headerText(req.headers["origin"]);
  if (origin === undefined) return;
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host !== headerText(req.headers["host"])) throw new ApiError("cross_origin");
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  const ops = path.startsWith("/api/ops/");
  try {
    if (method === "GET" && path === "/api/health") return send(res, { status: 200, json: { status: "ok" } });
    const { match, pathKnown } = matchRoute(method, path);
    if (!match) throw new ApiError(pathKnown ? "method_not_allowed" : "not_found");
    const { route, params } = match;
    const remote = req.socket.remoteAddress ?? "unknown";

    if (route.limited) {
      const retryAfter = await refuseAfterRate(remote).catch((error: unknown) => {
        const known = asDatabaseError(error);
        if (known instanceof ApiError && known.code === "database_unavailable") return null;
        throw error;
      });
      if (retryAfter !== null) throw new ApiError("rate_limited", { retryAfter });
    }
    if (route.method === "*" && method !== "GET") throw new ApiError("read_only");

    const { body, contentType } = await loadBody(req, route.body, method);
    if (CHANGING_METHODS.has(method)) refuseForeignOrigin(req);

    const ctx: Context = {
      method,
      path,
      query: url.searchParams,
      headers: req.headers,
      remote,
      params,
      body,
      json: route.body === "json" ? (parseJson(body.toString("utf8")) ?? {}) : undefined,
      contentType,
    };
    if (route.auth === "operator") {
      const token = sessionToken(ctx);
      if (!token) throw new ApiError("unauthenticated");
      if (!(await hasLiveSession(await database(), token))) throw new ApiError("unauthenticated");
    } else {
      await ensureSchema();
    }
    send(res, await route.handler(ctx));
  } catch (error) {
    send(res, errorReply(error, ops));
  }
}

// ---- pages and assets ------------------------------------------------------------------------

const PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));

const PAGES: RegExp[] = [
  /^\/$/,
  /^\/claim\/new$/,
  /^\/claim\/[^/]+\/sent$/,
  /^\/confirm\/[^/]+$/,
  /^\/s\/[^/]+$/,
  /^\/find$/,
  /^\/ops\/sign-in$/,
  /^\/ops\/claims$/,
  /^\/ops\/claims\/[^/]+(\/(quote(\/[^/]+)?|declined|dispatched))?$/,
  /^\/ops\/imports$/,
  /^\/ops\/editions$/,
];

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const PAGE_HEADERS: Record<string, string> = {
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
};

function sendFile(res: ServerResponse, file: string, status = 200, cache = "no-cache"): void {
  const body = readFileSync(file);
  res.writeHead(status, { ...PAGE_HEADERS, "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": String(body.length), "cache-control": cache });
  res.end(body);
}

function pages(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const notFound = (): void => {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    res.end("Not found");
  };
  if (req.method !== "GET" && req.method !== "HEAD") return notFound();
  const path = url.pathname;
  const isAsset = path.startsWith("/assets/") || path.startsWith("/fonts/");
  if (isAsset) {
    const file = normalize(join(PUBLIC_DIR, path));
    if (!file.startsWith(PUBLIC_DIR + sep) || !existsSync(file) || !statSync(file).isFile()) return notFound();
    return sendFile(res, file, 200, path.startsWith("/fonts/") ? "public, max-age=31536000, immutable" : "no-cache");
  }
  const index = join(PUBLIC_DIR, "index.html");
  if (PAGES.some((page) => page.test(path))) return sendFile(res, index);
  const lastSegment = path.split("/").pop() ?? "";
  if (lastSegment.includes(".")) return notFound();
  sendFile(res, index, 404);
}

export function startServer(port: number): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      void api(req, res, url);
      return;
    }
    try {
      pages(req, res, url);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  server.keepAliveTimeout = 5000;
  server.listen(port, "0.0.0.0");
  return server;
}
