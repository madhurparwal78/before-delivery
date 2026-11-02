import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { actorForToken } from "./auth.ts";
import { config } from "./config.ts";
import { notFound } from "./errors.ts";
import { hub } from "./events.ts";
import { parseCookies, Router, sendError } from "./http.ts";
import { certificationRoutes } from "./routes/certification.ts";
import { ingestRoutes } from "./routes/ingest.ts";
import { readRoutes } from "./routes/reads.ts";
import { sessionRoutes } from "./routes/session.ts";
import { tagRoutes } from "./routes/tags.ts";
import { termRoutes } from "./routes/terms.ts";
import { userRoutes } from "./routes/users.ts";
import { migrateAndSeed } from "./schema.ts";
import { startProbes } from "./status.ts";

const PUBLIC = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const PAGES = new Set(["/signin", "/catalog", "/glossary", "/admin"]);
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};
/** Only the built client assets are served; nothing else on disk is reachable. */
const ASSETS = /^\/(app\.js|app\.css|favicon\.svg|fonts\/[a-z0-9-]+\.woff2)$/;

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const router = new Router();
router.add(...sessionRoutes, ...readRoutes, ...tagRoutes, ...ingestRoutes, ...termRoutes, ...certificationRoutes, ...userRoutes);

async function serveFile(res: ServerResponse, path: string, cache: string): Promise<void> {
  const body = await readFile(join(PUBLIC, path));
  res.writeHead(200, { "Content-Type": TYPES[extname(path)], "Cache-Control": cache, ...SECURITY_HEADERS });
  res.end(body);
}

async function servePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
    res.writeHead(302, { Location: "/catalog" }).end();
    return;
  }
  if (req.method === "GET" && ASSETS.test(url.pathname)) {
    await serveFile(res, url.pathname.slice(1), "no-cache");
    return;
  }
  if (req.method === "GET" && PAGES.has(url.pathname)) {
    if (url.pathname !== "/signin" && !(await actorForToken(parseCookies(req.headers.cookie).strata_session))) {
      res.writeHead(302, { Location: "/signin", "Cache-Control": "no-store" }).end();
      return;
    }
    await serveFile(res, "index.html", "no-store");
    return;
  }
  sendError(res, notFound());
}

async function main(): Promise<void> {
  await migrateAndSeed();
  await hub.start();
  void startProbes();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const work = url.pathname.startsWith("/api/") ? router.handle(req, res, url) : servePage(req, res, url);
    work.catch((error: unknown) => sendError(res, error));
  });
  server.requestTimeout = 0;
  server.listen(config.port, "0.0.0.0", () => console.log(`Strata listening at 0.0.0.0:${config.port}`));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
