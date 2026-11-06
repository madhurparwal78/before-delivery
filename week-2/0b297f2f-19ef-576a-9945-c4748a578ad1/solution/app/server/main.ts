import http from "node:http";
import { config } from "./config.js";
import { ensureReady } from "./db.js";
import { ApiError, notFound } from "./errors.js";
import { dispatch, JSON_LIMIT, PAGE_HEADERS, pageShell, PHOTO_LIMIT, readBody, send, sendError, staticAsset } from "./http.js";
import { startBackgroundWork } from "./publisher.js";
import { galleryRoutes } from "./routes/gallery.js";
import { objectRoutes } from "./routes/objects.js";
import { placementRoutes } from "./routes/placements.js";
import { linkState, previewRoutes } from "./routes/preview.js";
import { serviceStatus, startProbes } from "./status.js";

const routes = [...galleryRoutes, ...objectRoutes, ...placementRoutes, ...previewRoutes];

const PAGE_PATHS = [/^\/$/, /^\/records$/, /^\/records\/[^/]+$/];
const LENDER_PAGE = /^\/p\/([^/]+)$/;
const READ_ONLY = /^\/(api\/)?p\//;
const PHOTO_UPLOAD = /^\/api\/objects\/[^/]+\/photos$/;

const LENDER_HEADINGS = {
  404: "This preview link isn't valid.",
  410: "This preview has been withdrawn by the museum.",
  503: "This preview can't be shown right now. Please try again later.",
} as const;

async function page(status: number, heading?: string) {
  const html = await pageShell();
  const body = heading
    ? html.replace('<div id="root"></div>', `<div id="root"><main id="main" tabindex="-1"><h1>${heading}</h1></main></div>`)
    : html;
  return { status, raw: body, contentType: "text/html; charset=utf-8", headers: PAGE_HEADERS };
}

async function lenderPage(token: string) {
  try {
    const link = await linkState(token);
    if (link.state === "unknown") return page(404, LENDER_HEADINGS[404]);
    if (link.state === "withdrawn") return page(410, LENDER_HEADINGS[410]);
    return page(200);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) return page(503, LENDER_HEADINGS[503]);
    throw error;
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const isGet = method === "GET" || method === "HEAD";
  const body = await readBody(req, method === "POST" && PHOTO_UPLOAD.test(url.pathname) ? PHOTO_LIMIT : JSON_LIMIT);
  if (body === null) throw new ApiError(413, "body_too_large", "That request is larger than Hangline accepts.");
  if (READ_ONLY.test(url.pathname) && !isGet) throw new ApiError(405, "read_only", "Preview links are read-only.");
  if (url.pathname === "/api/health") return send(res, { status: 200, json: { status: "ok" } });
  if (url.pathname === "/api/status" && isGet) return send(res, { status: 200, json: serviceStatus() });
  if (url.pathname.startsWith("/api/")) return dispatch(routes, req, res, url, body);
  if (!isGet) throw notFound();
  const lender = LENDER_PAGE.exec(url.pathname);
  if (lender) return send(res, await lenderPage(decodeURIComponent(lender[1])));
  if (PAGE_PATHS.some((p) => p.test(url.pathname))) return send(res, await page(200));
  const asset = await staticAsset(url.pathname);
  if (asset) return send(res, asset);
  send(res, { status: 404, raw: "Not found", contentType: "text/plain; charset=utf-8" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (error instanceof ApiError) return sendError(res, error);
    console.error("request failed:", error instanceof Error ? error.message : error);
    if (!res.headersSent) sendError(res, new ApiError(500, "internal_error", "Something went wrong on the server."));
  });
});

server.keepAliveTimeout = 5000;
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Hangline listening on 0.0.0.0:${config.port}`);
  startProbes();
  startBackgroundWork();
  ensureReady().catch(() => console.log("database not reachable yet; retrying in the background"));
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
