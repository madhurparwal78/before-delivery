import http from "node:http";
import { readFileSync, existsSync, statSync, createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySchema, query } from "./db.ts";
import { userFromSession, purgeStale, hashPassword } from "./identity.ts";
import { limits, appPublicPort, appOrigin, grading } from "./config.ts";
import { ApiError, Router } from "./http.ts";
import { router as apiRouter } from "./api.ts";
import * as s3 from "./s3.ts";
import * as meili from "./meili.ts";
import { seedIfAbsent } from "./seed.ts";
import { latestStorageProbe } from "./probe.ts";
import { logger } from "./logger.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public");

const FORBIDDEN_FILES = new Set(["run.json", "package.json", "package-lock.json", "env", ".env", "tsconfig.json"]);

let dbReady = false;

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
  };
  return types[ext] ?? "application/octet-stream";
}

const INDEX = readFileSync(path.join(publicDir, "index.html"), "utf8");

function sendIndex(res: http.ServerResponse): void {
  // Cross-origin isolation lets the kernel's interrupt flag live in shared memory,
  // so I,I stops a busy loop that keeps the worker's message queue blocked.
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
  });
  res.end(INDEX);
}

function sendError(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  const text = JSON.stringify(body);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

const pageRouter = new Router();
for (const route of ["/", "/signin", "/signup", "/verify", "/invite", "/notebooks"]) {
  pageRouter.add("GET", route, async (ctx) => {
    sendIndex(ctx.res);
  });
}
pageRouter.add("GET", "/notebooks/:id", async (ctx) => {
  sendIndex(ctx.res);
});
pageRouter.add("GET", "/verify/:token", async (ctx) => {
  sendIndex(ctx.res);
});
pageRouter.add("GET", "/invite/:token", async (ctx) => {
  sendIndex(ctx.res);
});

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer | { error: "too_large" }> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > maxBytes) return { error: "too_large" };
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        resolve({ error: "too_large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${appPublicPort}`);
    const method = req.method ?? "GET";
    const originHeader = req.headers.origin;
    if (originHeader !== undefined && originHeader !== "" && originHeader !== appOrigin && originHeader !== `http://127.0.0.1:${appPublicPort}` && originHeader !== `http://localhost:${appPublicPort}`) {
      if (method !== "GET" && method !== "HEAD") {
        sendError(res, 403, { error: "cross_origin", message: "Cross-origin requests are refused." });
        return;
      }
    }
    const cookieHeader = req.headers.cookie;
    let sessionValue: string | undefined;
    if (cookieHeader !== undefined) {
      for (const part of cookieHeader.split(";")) {
        const trimmed = part.trim();
        if (trimmed.startsWith("bp_session=")) sessionValue = decodeURIComponent(trimmed.slice("bp_session=".length));
      }
    }
    const user = dbReady ? await userFromSession(sessionValue) : null;

    if (url.pathname === "/api/notebooks/import" && method === "POST") {
      if (user === null) {
        sendError(res, 401, { error: "unauthenticated", message: "Sign in to continue." });
        return;
      }
      const body = await readBody(req, limits.import_max_bytes + 1);
      if ("error" in body) {
        sendError(res, 413, { error: "too_large", message: `File is larger than ${limits.import_max_bytes.toLocaleString("en-US")} bytes` });
        return;
      }
      const ctx = { req, res, method, path: url.pathname, params: {}, query: url.searchParams, body, user };
      await apiRouter.dispatch(ctx);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      if (!dbReady) {
        sendError(res, 503, { status: "starting" });
        return;
      }
      const isJsonRequest = (req.headers["content-type"] ?? "").includes("application/json");
      let body: unknown = null;
      if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
        if (isJsonRequest || !url.pathname.startsWith("/api/notebooks/")) {
          const raw = await readBody(req, 8_000_001);
          if ("error" in raw) {
            sendError(res, 413, { error: "too_large", message: "Request body is larger than 8,000,000 bytes" });
            return;
          }
          if (raw.length > 0) {
            try {
              body = JSON.parse(raw.toString("utf8"));
            } catch {
              sendError(res, 422, { error: "validation_failed", message: "Some fields are not valid.", errors: [{ path: "body", message: "is not valid JSON" }] });
              return;
            }
          }
        }
      }
      const ctx = { req, res, method, path: url.pathname, params: {}, query: url.searchParams, body, user };
      const handled = await apiRouter.dispatch(ctx);
      if (!handled) sendError(res, 404, { error: "not_found", message: "Notebook not found." });
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendError(res, 404, { error: "not_found", message: "Notebook not found." });
      return;
    }

    const page = await pageRouter.dispatch({ req, res, method, path: url.pathname, params: {}, query: url.searchParams, body: null, user });
    if (page) return;

    // Static files: never source, configuration or credentials.
    const target = path.normalize(url.pathname);
    if (target.startsWith("/api/") || target.includes("..") || target.startsWith("/src") || target.startsWith("/dist/server") || target.startsWith("/node_modules") || FORBIDDEN_FILES.has(path.basename(target)) || target.endsWith(".ts") || target.endsWith(".map") || target === "/build.mjs" || target === "/package-lock.json") {
      sendError(res, 404, { error: "not_found", message: "Notebook not found." });
      return;
    }
    const filePath = path.join(publicDir, target);
    if (!filePath.startsWith(publicDir)) {
      sendError(res, 404, { error: "not_found", message: "Notebook not found." });
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      if (req.headers.accept?.includes("text/html")) {
        sendIndex(res);
        return;
      }
      sendError(res, 404, { error: "not_found", message: "Notebook not found." });
      return;
    }
    const stat = statSync(filePath);
    res.writeHead(200, {
      "content-type": contentTypeFor(filePath),
      "content-length": stat.size,
      "cache-control": path.extname(filePath) === ".html" ? "no-store" : "public, max-age=3600",
      "cross-origin-resource-policy": "same-origin",
    });
    if (method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err instanceof ApiError) {
      const body: Record<string, unknown> = { error: err.code, message: err.message };
      if (err.errors !== undefined) body["errors"] = err.errors;
      if (err.extra !== undefined) Object.assign(body, err.extra);
      sendError(res, err.status, body);
      return;
    }
    logger.error(`unhandled: ${(err as Error).message}`);
    sendError(res, 500, { error: "internal", message: "Something went wrong." });
  }
});

server.on("clientError", (_err, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

async function boot(): Promise<void> {
  server.listen(appPublicPort, "0.0.0.0", () => {
    logger.info(`brackenpad listening on 0.0.0.0:${appPublicPort}`);
  });
  void s3.createBucket();
  void meili.applySettings();
  for (;;) {
    try {
      await applySchema();
      dbReady = true;
      break;
    } catch (err) {
      logger.warn(`postgres not ready: ${(err as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await seedIfAbsent();
  const purge = setInterval(() => {
    void purgeStale(limits.presence_timeout_ms);
  }, Math.max(1000, Math.floor(limits.presence_timeout_ms / 3)));
  purge.unref();
  void fs.access(publicDir).catch(() => logger.warn("public dir missing"));
}

void boot();
