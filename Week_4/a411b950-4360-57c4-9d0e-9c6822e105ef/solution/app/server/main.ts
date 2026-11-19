import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { config } from "./config.js";
import { isConnectionError, markReady, pool } from "./db.js";
import { HttpError, notFound, sendError, sendJson } from "./http.js";
import { startMailWorker } from "./mail.js";
import { compile, dispatch, match } from "./router.js";
import { enquiryRoutes } from "./routes/enquiries.js";
import { journeyRoutes } from "./routes/journey.js";
import { monthRoutes } from "./routes/months.js";
import { projectRoutes } from "./routes/projects.js";
import { proposalRoutes } from "./routes/proposals.js";
import { sessionRoutes, settings } from "./routes/session.js";
import { applySchemaAndSeed, seedStems } from "./seed.js";

const CLIENT_DIR = join(import.meta.dirname, "..", "client");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
};

const routes = compile([...journeyRoutes, ...monthRoutes, ...enquiryRoutes, ...proposalRoutes, ...projectRoutes, ...sessionRoutes]);

/** The built front end, held in memory: only these files are ever served. */
const assets = new Map<string, Buffer>();
function collect(directory: string, prefix: string): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) collect(path, `${prefix}${name}/`);
    else if (TYPES[extname(name)]) assets.set(`/${prefix}${name}`, readFileSync(path));
  }
}
collect(join(CLIENT_DIR, "assets"), "assets/");

const pages = {
  journey: readFileSync(join(CLIENT_DIR, "journey.html"), "utf8"),
  proposal: readFileSync(join(CLIENT_DIR, "proposal.html"), "utf8"),
  console: readFileSync(join(CLIENT_DIR, "console.html"), "utf8"),
};

const NOT_FOUND_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · Earshot</title><style>html{background:#121409;color:#efe4c8;font:16px/1.6 system-ui,sans-serif}main{max-width:32rem;margin:20vh auto;padding:0 24px}a{color:#efe4c8;text-underline-offset:4px}a:focus-visible{outline:3px solid #ff6a1a;outline-offset:3px}</style></head><body><main><h1>Nothing is here.</h1><p><a href="/">Back to the corridor</a></p></main></body></html>`;

async function sendPage(res: ServerResponse, page: keyof typeof pages, headers: Record<string, string> = {}): Promise<void> {
  let zone = "UTC";
  try {
    zone = (await settings()).time_zone;
  } catch {
    // The page still renders; dates fall back to UTC until the database answers.
  }
  const html = Buffer.from(pages[page].replace('content="UTC" data-zone', `content="${zone}" data-zone`));
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(html.length),
    "Cache-Control": "no-cache",
    "Referrer-Policy": "same-origin",
    ...headers,
  });
  res.end(html);
}

async function serveFrontEnd(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") notFound();
  if (path === "/") return sendPage(res, "journey");
  if (path === "/console") return sendPage(res, "console");
  if (/^\/listen\/[^/]+$/.test(path)) {
    return sendPage(res, "journey", { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  }
  if (/^\/p\/[^/]+$/.test(path)) return sendPage(res, "proposal", { "Referrer-Policy": "no-referrer" });
  const asset = assets.get(path);
  if (!asset) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(NOT_FOUND_PAGE);
    return;
  }
  res.writeHead(200, {
    "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
    "Content-Length": String(asset.length),
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.end(asset);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const raw = req.url ?? "/";
    if (raw.includes("..") || /%2e/i.test(raw) || raw.includes("\\")) notFound();
    const url = new URL(raw, "http://earshot.local");
    if (url.pathname === "/api/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    const found = match(routes, url.pathname);
    if (found) await dispatch(found.route, found.params, req, res, url);
    else if (url.pathname.startsWith("/api/")) notFound();
    else await serveFrontEnd(req, res, url.pathname);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof HttpError) sendError(res, error);
    else if (error instanceof URIError) sendError(res, new HttpError(404, "not_found", "Nothing is here."));
    else if (isConnectionError(error)) sendError(res, new HttpError(503, "database_unavailable", "The database is unreachable."));
    else {
      console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Unexpected error");
      sendError(res, new HttpError(500, "internal", "Something went wrong."));
    }
  }
}

/** Connects, applies the schema and seed, then starts the background work; retries every 5 s while the database is down. */
async function start(): Promise<void> {
  try {
    await pool.query("SELECT 1");
    await applySchemaAndSeed();
  } catch (error) {
    console.error(`Database not ready (${error instanceof Error ? error.message : "unknown"}); retrying in 5 s`);
    setTimeout(() => void start(), 5000);
    return;
  }
  markReady();
  startMailWorker();
  seedStems();
}

createServer((req, res) => void handle(req, res)).listen(config.port, "0.0.0.0", () => {
  console.log(`Earshot listening on 0.0.0.0:${config.port}`);
  void start();
});
