import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { viewerOf } from "./auth";
import type { Viewer } from "./auth";
import { config } from "./config";
import { migrate } from "./db";
import { fail, isReply, json, readJson, send } from "./http";
import type { Reply } from "./http";
import { attachLive } from "./live";
import { startMailRetries } from "./mail";
import { gradingKeyMatches } from "./grading";
import { logTooLong } from "./runCheck";
import { isPublic, routes } from "./routes";
import type { PrivateRoute } from "./routes";

const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const RETRY_DATABASE_MS = 2000;
const PAGES = [/^\/$/, /^\/history$/, /^\/boards$/, /^\/race(\/[^/]+)?$/, /^\/settings$/, /^\/account$/, /^\/signup$/, /^\/signin$/, /^\/reset(\/[^/]+)?$/, /^\/verify\/[^/]+$/, /^\/runs\/[^/]+$/];
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

let ready = false;

async function connectDatabase(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      ready = true;
      startMailRetries();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DATABASE_MS));
    }
  }
}

function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (req.method === "GET" || req.method === "HEAD" || origin === undefined) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

async function handleApi(req: IncomingMessage, url: URL): Promise<Reply> {
  if (url.pathname === "/api/health") return ready ? json(200, { status: "ok" }) : json(503, { status: "starting" });
  if (!ready) return json(503, { status: "starting" });
  if (crossOrigin(req)) return fail(403, "cross_origin");
  let params: readonly string[] = [];
  const route = routes.find((candidate) => {
    const match = candidate.method === req.method ? candidate.pattern.exec(url.pathname) : null;
    if (match) params = match.slice(1).map(decodeURIComponent);
    return match !== null;
  });
  if (!route) return fail(404, "not_found");
  if (route.access === "grading" && !gradingKeyMatches(req.headers["x-grading-key"] as string | undefined)) return fail(404, "not_found");
  const viewer = await viewerOf(req);
  if (isPublic(route)) {
    const body = req.method === "GET" || req.method === "DELETE" ? null : await readJson(req);
    return isReply(body) ? body : route.handler({ req, url, params, viewer, body });
  }
  return handlePrivate(route, req, url, params, viewer);
}

async function handlePrivate(route: PrivateRoute, req: IncomingMessage, url: URL, params: readonly string[], viewer: Viewer | null): Promise<Reply> {
  if (viewer === null) return fail(401, "unauthenticated");
  if (route.access === "verified" && !viewer.verified) return fail(403, "email_unverified");
  const body = req.method === "GET" ? null : await readJson(req);
  if (isReply(body)) return body;
  if (route.carriesLog && body && logTooLong(body.value)) return fail(413, "log_too_long", { limit: config.maxLogEvents });
  return route.handler({ req, url, params, viewer, body });
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const known = PAGES.some((page) => page.test(pathname));
  const asset = pathname.startsWith("/assets/");
  const file = asset ? normalize(pathname).replace(/^(\.\.[/\\])+/, "") : "index.html";
  try {
    const bytes = await readFile(join(PUBLIC_DIR, file));
    res.writeHead(known || asset ? 200 : 404, {
      ...SECURITY_HEADERS,
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": /-[A-Z0-9]{8}\.\w+$/.test(file) ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const respond = url.pathname.startsWith("/api/")
    ? handleApi(req, url).then((reply) => send(res, { ...reply, headers: { ...SECURITY_HEADERS, "Cache-Control": "no-store", ...reply.headers } }))
    : serveStatic(res, url.pathname);
  respond.catch(() => {
    if (!res.headersSent) send(res, fail(500, "server_error"));
    else res.destroy();
  });
});

attachLive(server);
server.listen(config.port, "0.0.0.0");
void connectDatabase();
