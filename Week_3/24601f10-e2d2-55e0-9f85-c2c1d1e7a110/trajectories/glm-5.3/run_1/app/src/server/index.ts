import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { sendJson, sendError, errors, ApiError } from "./errors.js";
import { applySchema } from "./auth.js";
import { s3, ensureBucket } from "./s3.js";
import { handleApi } from "./routes.js";
import { runDeadlines } from "./timers.js";

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

let pgReady = false;

const ASSET_DIR = new URL("../../dist/client/assets/", import.meta.url).pathname;

function serveFile(res: ServerResponse, path: string): boolean {
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  const ext = extname(path).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  const body = readFileSync(path);
  res.writeHead(200, { "Content-Type": type, "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
  return true;
}

const INDEX_HTML = readFileSync(new URL("../../dist/client/index.html", import.meta.url).pathname, "utf8");

function serveIndex(res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(INDEX_HTML);
}

export function isPagePath(pathname: string): boolean {
  if (pathname === "/") return true;
  const pagePrefixes = ["/signup", "/signin", "/t", "/s/", "/u/", "/tournaments"];
  if (pagePrefixes.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p))) {
    // /t and /t/new etc. all render the client shell
    return true;
  }
  return false;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = req.headers.host ?? "";
    return o.host === host;
  } catch {
    return false;
  }
}

const JSON_LIMIT = 65536;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > JSON_LIMIT) throw errors.tooLargeJson();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > JSON_LIMIT) throw errors.tooLargeJson();
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errors.validationMsg("Check the highlighted fields.");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/")) {
      // Origin check for state-changing requests
      if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
        throw errors.crossSite();
      }
      if (!pgReady) {
        res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "unavailable", message: "starting" }));
        return;
      }
      await handleApi(req, res, pathname);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      if (!sameOrigin(req)) throw errors.crossSite();
    }

    // static client assets
    if (pathname.startsWith("/assets/")) {
      const file = join(ASSET_DIR, pathname.slice("/assets/".length));
      if (serveFile(res, file)) return;
      throw errors.notFound();
    }
    // never serve source, manifest, package or env files
    if (
      pathname.startsWith("/src/") ||
      pathname === "/run.json" ||
      pathname.startsWith("/package") ||
      pathname.startsWith("/.env") ||
      pathname.endsWith(".map") ||
      pathname.endsWith(".ts")
    ) {
      throw errors.notFound();
    }
    if (isPagePath(pathname)) {
      serveIndex(res);
      return;
    }
    // any other non-API path is a not-found page
    serveIndex(res);
  } catch (e) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (e instanceof ApiError) {
      sendError(res, e);
    } else {
      console.error("unhandled", e);
      sendJson(res, 500, { error: "internal", message: "Something went wrong." });
    }
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith("/api/tournaments/")) {
      socket.destroy();
      return;
    }
    // origin check on WebSocket upgrade
    const origin = req.headers.origin;
    if (origin) {
      try {
        const o = new URL(origin);
        if (o.host !== (req.headers.host ?? "")) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    if (!pgReady) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }
    const { handleLiveUpgrade } = await import("./live-routes.js");
    await handleLiveUpgrade(wss, req, socket, head, url);
  } catch {
    socket.destroy();
  }
});

async function boot(): Promise<void> {
  // retry Postgres until reachable
  for (;;) {
    try {
      await applySchema();
      pgReady = true;
      break;
    } catch (e) {
      console.error("postgres not ready, retrying...", (e as Error).message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  try {
    await ensureBucket();
    const up = await s3.ping();
    console.log("minio", up ? "ok" : "unreachable");
  } catch (e) {
    console.error("minio unreachable at boot:", (e as Error).message);
  }
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`cupfold serving on 0.0.0.0:${config.port}`);
  });
  // apply due deadlines at least once a second
  setInterval(() => {
    runDeadlines().catch((e) => console.error("deadline error", e));
  }, 1000);
}

boot().catch((e) => {
  console.error("boot failed", e);
  process.exit(1);
});

export { server, readJsonBody, JSON_LIMIT };
