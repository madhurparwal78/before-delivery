// Rushes server: one process, bound to 0.0.0.0 on APP_PUBLIC_PORT (brief: Deployment).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { config } from "./config.js";
import { accountView, sessionAccount } from "./access.js";
import { pool } from "./db.js";
import { refuse } from "./errors.js";
import { crossOrigin, match, readRequestBody, send, sendError, toApiError } from "./http.js";
import { applyDueLifts } from "./lift.js";
import { syncBilling } from "./billing.js";
import { loadCursorKey } from "./cursor.js";
import { sendPendingDigests } from "./digest.js";
import { migrate, writeSeedObjects } from "./seed.js";
import "./routes/auth.js";
import "./routes/workspaces.js";
import "./routes/references.js";
import "./routes/clusters.js";
import "./routes/reviews.js";
import "./routes/public.js";

const CLIENT_DIR = new URL("./client/assets/", import.meta.url);
const INDEX_HTML = new URL("../public/index.html", import.meta.url);

/** Rushes' screens (brief: Screens and layout); every other address answers 404 with the not-found page. */
const SCREENS = [
  /^\/$/,
  /^\/signin$/,
  /^\/signup$/,
  /^\/invite\/[^/]+$/,
  /^\/w\/[a-z0-9-]+$/,
  /^\/w\/[a-z0-9-]+\/admin$/,
  /^\/w\/[a-z0-9-]+\/clusters\/[^/]+$/,
  /^\/explore$/,
  /^\/@[^/]+$/,
  /^\/c\/[^/]+$/,
  /^\/review\/[^/]+$/,
];

const ASSET_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  woff: "font/woff",
};

const PAGE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
};

async function serveAsset(res: ServerResponse, name: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith(".")) return false;
  const ext = name.split(".").pop() ?? "";
  const type = ASSET_TYPES[ext];
  if (!type) return false;
  const file = new URL(name, CLIENT_DIR);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  const hashed = /-[A-Z0-9]{8}\./.test(name);
  res.writeHead(200, {
    ...PAGE_HEADERS,
    "Content-Type": type,
    "Content-Length": info.size,
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(await readFile(file));
  return true;
}

/** The built faces, preloaded from the page head so the first paint already sets them (client fonts.css). */
const FONT_PRELOADS = readdir(CLIENT_DIR)
  .then((names) =>
    names
      .filter((name) => name.endsWith(".woff2"))
      .map((name) => `<link rel="preload" href="/assets/${name}" as="font" type="font/woff2" crossorigin />`)
      .join("\n    "),
  );

async function servePage(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (path.startsWith("/assets/") && (await serveAsset(res, path.slice("/assets/".length)))) return;
  const known = SCREENS.some((screen) => screen.test(path));
  // The signed-in account rides along with the page, so the first render already knows who is looking.
  const account = await sessionAccount(req);
  const session = JSON.stringify(account ? await accountView(account) : null).replace(/</g, "\\u003c");
  const html = (await readFile(INDEX_HTML, "utf8"))
    .replace("<!--fonts-->", await FONT_PRELOADS)
    .replace("<!--session-->", `<script id="rushes-session" type="application/json">${session}</script>`);
  res.writeHead(known ? 200 : 404, { ...PAGE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(req.method === "HEAD" ? undefined : html);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const now = new Date();
  const url = new URL(req.url ?? "/", "http://rushes.invalid");
  const raw = (req.url ?? "/").split("?")[0] ?? "/";
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = "/..";
  }
  if (raw.includes("..") || /%2e%2e/i.test(raw) || path.includes("..") || path.includes("\\")) {
    if (path.startsWith("/api/") || path.startsWith("/media/")) return sendError(res, refuse("not_found"));
    res.writeHead(404, { ...PAGE_HEADERS, "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(INDEX_HTML));
    return;
  }
  if (path === "/api/health") return send(res, 200, { status: "ok" });
  if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/media/")) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendError(res, refuse("not_found"));
    return servePage(req, res, url.pathname);
  }
  try {
    if (crossOrigin(req)) throw refuse("cross_origin");
    const found = match(req.method ?? "GET", url.pathname);
    if (!found) {
      req.resume();
      throw refuse("not_found");
    }
    const body = await readRequestBody(req, found.route.body, found.route.part);
    await applyDueLifts(pool, now);
    await found.route.handler({ req, res, now, params: found.params, query: url.searchParams, ...body });
  } catch (error) {
    const known = toApiError(error);
    if (!known) throw error;
    sendError(res, known);
  }
}

/** Retries `work` until it succeeds, without blocking start-up (storage or billing may be down at boot). */
function retryInBackground(name: string, work: () => Promise<void>, everyMs: number): void {
  const attempt = (): void => {
    work().catch((error: unknown) => {
      console.warn(`${name} pending: ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(attempt, everyMs).unref();
    });
  };
  attempt();
}

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      console.warn(`database not ready: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate();
  await loadCursorKey();
  await Promise.allSettled([writeSeedObjects(), syncBilling()]);
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) sendError(res, refuse("internal"));
      else res.destroy();
    });
  });
  server.requestTimeout = 300_000;
  server.listen(config.port, "0.0.0.0", () => console.log(`Rushes listening on 0.0.0.0:${config.port}`));
  retryInBackground("seed objects", writeSeedObjects, 10_000);
  retryInBackground("billing sync", syncBilling, 10_000);
  // Lifts happen on every request; this tick also lifts when nobody is asking, then sends due digests.
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    applyDueLifts(pool, new Date())
      .then(sendPendingDigests)
      .catch((error: unknown) => console.warn("lift tick failed", error))
      .finally(() => {
        ticking = false;
      });
  }, 2000);
  const stop = (): void => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

void main();
