import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { seedStaff } from "./auth.js";
import { config } from "./config.js";
import { applySchema, tx } from "./db.js";
import { ApiError, sendError, sendJson } from "./http.js";
import { ensureCollections } from "./pocketbase.js";
import { dispatch } from "./router.js";
import { startWorkers } from "./workers.js";
import "./routes/accounts.js";
import "./routes/benches.js";
import "./routes/reservations.js";
import "./routes/checkout.js";
import "./routes/documents.js";
import "./routes/desk.js";
import "./routes/content.js";
import "./routes/checkin.js";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const PAGES = new Set(["/", "/account", "/desk", "/desk/content", "/checkin"]);
const SERVED_DIRS = ["/assets/", "/fonts/"];
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};
const BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };

let shell: Buffer | null = null;

async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const asset = SERVED_DIRS.some((dir) => path.startsWith(dir)) ? normalize(path) : null;
  const type = asset ? TYPES[extname(asset)] : undefined;
  if (asset && type && !asset.includes("..")) {
    try {
      const body = await readFile(join(PUBLIC_DIR, asset));
      res.writeHead(200, { ...BASE_HEADERS, "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    } catch {
      // Unknown asset: fall through to the not-found page.
    }
  }
  shell ??= await readFile(join(PUBLIC_DIR, "index.html"));
  const status = PAGES.has(path) ? 200 : 404;
  res.writeHead(status, { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(req.method === "HEAD" ? undefined : shell);
}

let ready: Promise<void> = Promise.resolve();

async function boot(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await tx(seedStaff);
      return;
    } catch (error) {
      console.error(`database not ready: ${error instanceof Error ? error.message : "unknown error"}; retrying`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function prepareContent(): Promise<void> {
  for (;;) {
    try {
      await ensureCollections();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://app.invalid").pathname;
  if (path === "/api/health") return sendJson(res, 200, { status: "ok" });
  if (path.startsWith("/api/")) {
    void ready.then(() => dispatch(req, res));
    return;
  }
  void serveStatic(req, res, path).catch(() => {
    if (!res.headersSent) sendError(res, new ApiError(500, "internal", "The page could not be served."));
  });
});

server.listen(config.port, "0.0.0.0", () => {
  ready = boot().then(startWorkers);
  void prepareContent();
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
