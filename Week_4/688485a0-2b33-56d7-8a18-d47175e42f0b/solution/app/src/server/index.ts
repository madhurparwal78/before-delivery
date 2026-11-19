import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { applySchema, listen, state } from "./db.js";
import { ApiError } from "./errors.js";
import { handleApi, sendError } from "./http.js";
import { ensureBucket } from "./s3.js";
import "./routes/accounts.js";
import "./routes/projects.js";
import "./routes/documents.js";
import "./routes/queries.js";
import "./routes/structure.js";
import "./routes/feed.js";
import "./routes/files.js";
import "./routes/system.js";
import "./routes/grading.js";

const clientDir = fileURLToPath(new URL("../../client/", import.meta.url));
const SCREENS = /^\/(?:|signup|confirm|signin|projects|invites|p\/.*)$/;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

async function serveClient(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  const screen = SCREENS.test(pathname);
  const file = screen ? "index.html" : pathname.slice(1);
  const resolved = path.resolve(clientDir, file);
  if (!pathname.startsWith("/assets/") && !screen) return sendError(res, new ApiError("not_found"));
  if (!resolved.startsWith(clientDir)) return sendError(res, new ApiError("not_found"));
  try {
    const bytes = await readFile(resolved);
    const headers: Record<string, string> = {
      "content-type": TYPES[path.extname(resolved)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "cache-control": screen ? "no-cache" : "public, max-age=31536000, immutable",
    };
    if (screen) headers["referrer-policy"] = "same-origin";
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    sendError(res, new ApiError("not_found"));
  }
}

const server = http.createServer((req, res) => {
  void (async () => {
    const [pathname = "/", search = ""] = (req.url ?? "/").split("?");
    if (pathname.startsWith("/api/")) {
      if (!state.ready && pathname !== "/api/health") return sendError(res, new ApiError("starting"));
      return handleApi(req, res, pathname, new URLSearchParams(search));
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sendError(res, new ApiError("not_found"));
    return serveClient(req, res, pathname);
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    if (!res.headersSent) sendError(res, new ApiError("internal_error"));
    else res.end();
  });
});

process.on("unhandledRejection", (reason) => console.error("unhandled:", reason));

server.listen(config.port, "0.0.0.0", () => console.log(`jarful listening on ${config.port}`));

async function boot(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await listen();
      state.ready = true;
      break;
    } catch (error) {
      console.error("waiting for the database:", error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  ensureBucket().catch((error: Error) => console.error("object storage:", error.message));
}

void boot();
