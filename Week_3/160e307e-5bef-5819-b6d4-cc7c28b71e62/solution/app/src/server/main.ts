import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { ApiError } from "./errors";
import * as hub from "./hub";
import {
  BODY_LIMIT,
  isPage,
  makeSessionReaders,
  parseCookies,
  readJson,
  reply,
  sameOrigin,
  serveFile,
  sessionCookie,
} from "./http";
import type { Ctx } from "./http";
import { openLink } from "./auth";
import { leftMatch, sweepMatches } from "./matches";
import { tickQueue } from "./queue";
import { sweepRooms } from "./rooms";
import { routes } from "./routes";
import { attachSockets } from "./socket";

const PUBLIC_ROOT = fileURLToPath(new URL("./public", import.meta.url));
const STATIC_FILE = /^\/(?:app\.js|app\.css|fonts\/[A-Za-z0-9._-]+\.woff2)$/;

let shell: string | null = null;

/** The app shell, carrying the public address that room links are built from (brief: `#room-link` is `<APP_PUBLIC_URL>/join/<code>`). */
function pageHtml(): string {
  if (shell === null) {
    const escaped = config.publicUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    shell = readFileSync(join(PUBLIC_ROOT, "index.html"), "utf8").replace(
      "</head>",
      `  <meta name="public-url" content="${escaped}" />\n  </head>`,
    );
  }
  return shell;
}

function keyMatches(req: IncomingMessage): boolean {
  const given = Buffer.from(String(req.headers["x-grading-key"] ?? ""));
  const wanted = Buffer.from(config.gradingKey);
  return config.gradingKey !== "" && given.length === wanted.length && timingSafeEqual(given, wanted);
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const writes = method !== "GET" && method !== "HEAD";
  if (writes && !sameOrigin(req)) throw new ApiError(403, "CROSS_ORIGIN");
  const hit = routes.map((r) => ({ route: r, match: r.method === method ? r.pattern.exec(url.pathname) : null })).find((h) => h.match);
  if (!hit?.match) {
    if (routes.some((r) => r.pattern.test(url.pathname))) throw new ApiError(405, "METHOD_NOT_ALLOWED");
    throw new ApiError(404, "NOT_FOUND");
  }
  const route = hit.route;
  const params = hit.match.slice(1);
  if (route.grading && !keyMatches(req)) {
    reply(res, 404, { error: "NOT_FOUND" });
    return;
  }
  const body = writes ? await readJson(req, route.maxBody ?? BODY_LIMIT) : {};
  const cookies = parseCookies(req.headers.cookie);
  const setCookies: string[] = [];
  const readers = makeSessionReaders(req, cookies, setCookies);
  const ctx: Ctx = { req, url, params, body, cookies, setCookies, player: readers.player, maybePlayer: readers.maybePlayer };
  try {
    const result = await route.handle(ctx);
    reply(res, result.status, result.body, { ...(setCookies.length ? { "Set-Cookie": setCookies } : {}), ...result.headers });
  } catch (error) {
    if (setCookies.length && !res.headersSent) res.setHeader("Set-Cookie", setCookies);
    throw error;
  }
}

async function authLink(req: IncomingMessage, res: ServerResponse, token: string): Promise<boolean> {
  const cookies = parseCookies(req.headers.cookie);
  const setCookies: string[] = [];
  const readers = makeSessionReaders(req, cookies, setCookies);
  try {
    const opened = await openLink(token, await readers.maybePlayer());
    if (!opened) return false;
    const headers: Record<string, string | string[]> = { Location: `/?link=${opened.kind}`, "Cache-Control": "no-store" };
    if (opened.sessionToken) headers["Set-Cookie"] = sessionCookie(opened.sessionToken);
    res.writeHead(302, headers);
    res.end();
    return true;
  } catch (error) {
    if (error instanceof ApiError) return false;
    throw error;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://x");
  const readOnly = req.method === "GET" || req.method === "HEAD";
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  if (readOnly && url.pathname.startsWith("/auth/link/") && isPage(url.pathname)) {
    if (await authLink(req, res, url.pathname.slice("/auth/link/".length))) return;
  }
  if (readOnly && isPage(url.pathname)) {
    // brief: a session is created on the first request without a valid `dc_session`, a page request included
    const headers: Record<string, string | string[]> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };
    const setCookies: string[] = [];
    try {
      await makeSessionReaders(req, parseCookies(req.headers.cookie), setCookies).player();
    } catch {
      // database unreachable: the page still loads and `/api/me` reports the outage (brief: outage banner)
    }
    if (setCookies.length) headers["Set-Cookie"] = setCookies;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : pageHtml());
    return;
  }
  if (readOnly && STATIC_FILE.test(url.pathname)) {
    const cache = url.pathname.startsWith("/fonts/") ? "public, max-age=31536000, immutable" : "no-cache";
    if (serveFile(res, PUBLIC_ROOT, url.pathname, cache)) return;
  }
  throw new ApiError(404, "NOT_FOUND");
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (error instanceof ApiError) {
      reply(res, error.status, { error: error.code, ...error.extra });
      return;
    }
    console.error(error);
    reply(res, 500, { error: "INTERNAL_ERROR" });
  });
});
attachSockets(server);

let sweeping = false;
setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  Promise.allSettled([sweepMatches(), sweepRooms(), tickQueue()]).finally(() => {
    sweeping = false;
  });
}, 250);
setInterval(() => hub.beat((connection) => void leftMatch(connection).catch(() => undefined)), hub.PING_EVERY_MS);

process.on("unhandledRejection", (error) => console.error(error));
server.listen(config.port, "0.0.0.0", () => console.log(`Due Coin listening on ${config.port}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
