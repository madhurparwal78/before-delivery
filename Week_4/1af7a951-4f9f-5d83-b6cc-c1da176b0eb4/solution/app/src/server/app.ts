import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, checkOrigin, fail, MEMO_LIMIT, mediaType, notFound, readBody, readJson, send, sendError } from "./http.js";
import type { Context, Route } from "./router.js";
import { coachRoutes } from "./routes/coach.js";
import { dreamerRoutes } from "./routes/dreamer.js";
import { publicRoutes } from "./routes/public.js";
import { sessionRoutes } from "./routes/session.js";
import { MEMO_TYPES } from "./domain/memos.js";
import { viewerOf } from "./viewer.js";

const routes: Route[] = [...publicRoutes, ...sessionRoutes, ...dreamerRoutes, ...coachRoutes];

const MEMO_TYPE_SET: ReadonlySet<string> = new Set(MEMO_TYPES);

// Only the built browser bundle is served; source, manifests and node_modules are never reachable.
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const SCREENS = /^\/(signin|logbook|coach|enroll\/[^/]+|enrollments\/[^/]+)?$/;
const ASSET = /^\/assets\/[A-Za-z0-9._-]+$/;
const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const PAGE_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" };

/** The app shell answers every screen path; any other path gets it with 404, so the browser shows the not-found page. */
async function serveBundle(path: string, res: ServerResponse): Promise<void> {
  const asset = ASSET.test(path) ? normalize(join(PUBLIC_DIR, path)) : null;
  const type = asset ? ASSET_TYPES[extname(asset)] : undefined;
  let data: Buffer | null = null;
  if (asset && type && asset.startsWith(PUBLIC_DIR)) data = await readFile(asset).catch(() => null);
  if (data && type) {
    res.writeHead(200, { ...PAGE_HEADERS, "Content-Type": type, "Content-Length": String(data.length), "Cache-Control": "public, max-age=31536000, immutable" });
    res.end(data);
    return;
  }
  const shell = await readFile(join(PUBLIC_DIR, "index.html"));
  res.writeHead(SCREENS.test(path) ? 200 : 404, {
    ...PAGE_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(shell.length),
    "Cache-Control": "no-cache",
  });
  res.end(shell);
}

async function readRequest(route: Route, req: IncomingMessage): Promise<Pick<Context, "body" | "raw">> {
  if (route.body === "json") return { body: await readJson(req), raw: Buffer.alloc(0) };
  if (route.body === "memo") {
    const raw = await readBody(req, MEMO_LIMIT);
    if (!MEMO_TYPE_SET.has(mediaType(req))) throw fail(415, "unsupported_media_type");
    return { body: {}, raw };
  }
  return { body: {}, raw: Buffer.alloc(0) };
}

/** Boundary checks first, then the session, then the route; every failure leaves through sendError. */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? "/", "http://app.invalid").pathname;
  try {
    checkOrigin(req);
    if (!path.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") throw notFound();
      await serveBundle(path, res);
      return;
    }
    let params: string[] = [];
    const route = routes.find((candidate) => {
      const match = candidate.method === req.method ? candidate.pattern.exec(path) : null;
      if (match) params = match.slice(1).map((part) => decodeURIComponent(part));
      return match !== null;
    });
    if (!route) throw notFound();
    const { body, raw } = await readRequest(route, req);
    const viewer = await viewerOf(req);
    send(res, await route.run({ req, params, body, raw, now: new Date() }, viewer));
  } catch (error) {
    req.resume();
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    console.error(error);
    sendError(res, fail(500, "internal_error"));
  }
}
