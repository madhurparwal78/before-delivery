import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { databaseReady } from "../db/pool";
import { ApiError, refuse } from "./fail";
import { pageIsVisible } from "./pages";
import { JSON_LIMIT, UPLOAD_ALLOWANCE, readBody, type Ctx, type Handler, type Reply } from "./route";
import { viewerOf } from "./session";
import { healthReply } from "../routes/health";
import { latestEventId } from "../services/liveHub";

const CLIENT_DIR = path.join(__dirname, "client");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function send(res: ServerResponse, status: number, headers: Record<string, string>, body?: string | Buffer): void {
  res.writeHead(status, { "X-Content-Type-Options": "nosniff", ...headers });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  send(res, status, { "Content-Type": "application/json; charset=utf-8", ...headers }, JSON.stringify(body));
}

function sendReply(res: ServerResponse, reply: Reply): void {
  const headers = reply.headers ?? {};
  if (reply.file) send(res, reply.status, { "Content-Type": reply.file.contentType, ...headers }, reply.file.data);
  else if (reply.body === undefined) send(res, reply.status, headers);
  else sendJson(res, reply.status, reply.body, headers);
}

function sendFailure(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const failure = error instanceof ApiError ? error : new ApiError("internal_error");
  if (!(error instanceof ApiError)) console.error("request failed:", error instanceof Error ? error.stack : error);
  sendJson(res, failure.status, failure.body(), failure.headers());
}

function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

/** A percent sequence that does not decode names no record. */
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "\u0000";
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, handlers: Handler[]): Promise<void> {
  const method = req.method ?? "GET";
  let params: Record<string, string> = {};
  const handler = handlers.find((candidate) => {
    if (candidate.method !== method) return false;
    const match = candidate.pattern.exec(url.pathname);
    if (!match) return false;
    params = Object.fromEntries(candidate.keys.map((key, index) => [key, decoded(match[index + 1] ?? "")]));
    return true;
  });
  if (!handler || Object.values(params).some((value) => value.includes("\u0000"))) throw refuse("not_found");
  const query = [...url.searchParams];
  if (query.some(([key, value]) => `${key}${value}`.includes("\u0000"))) {
    url.search = "";
    for (const [key, value] of query) url.searchParams.append(key.replaceAll("\u0000", ""), value.replaceAll("\u0000", ""));
  }
  const limit = handler.body === "multipart" ? config.limits.resumeMaxBytes + UPLOAD_ALLOWANCE : handler.body === "png" ? 2 * UPLOAD_ALLOWANCE : JSON_LIMIT;
  const body = await readBody(req, handler.body, limit);
  if (method !== "GET" && crossOrigin(req)) throw refuse("forbidden");
  const viewer = await viewerOf(req);
  const ctx: Ctx = { req, res, url, params, viewer, ...body };
  const reply = await handler.execute(ctx);
  if (!res.headersSent) sendReply(res, reply);
}

let shell: string | undefined;

async function shellFor(status: number): Promise<string> {
  shell ??= await readFile(path.join(CLIENT_DIR, "index.html"), "utf8");
  const meta = JSON.stringify({
    toastSeconds: config.limits.toastSeconds,
    minPayReports: config.limits.minPayReports,
    searchPageSize: config.limits.searchPageSize,
  });
  const liveAfter = await latestEventId().catch(() => undefined);
  const resume = liveAfter === undefined ? "" : `<meta name="cb-live-after" content="${liveAfter}">`;
  return shell.replace(
    "<!--cb-meta-->",
    `<meta name="cb-config" content='${meta}'><meta name="cb-status" content="${status}">${resume}`,
  );
}

async function servePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const known = await pageIsVisible(url.pathname, await viewerOf(req));
  const status = known ? 200 : 404;
  send(res, status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, await shellFor(status));
}

async function serveAsset(res: ServerResponse, pathname: string): Promise<boolean> {
  const target = path.normalize(path.join(CLIENT_DIR, pathname));
  if (!target.startsWith(`${CLIENT_DIR}${path.sep}`) || path.basename(target) === "index.html") return false;
  try {
    const data = await readFile(target);
    const cache = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
    send(res, 200, { "Content-Type": TYPES[path.extname(target)] ?? "application/octet-stream", "Cache-Control": cache }, data);
    return true;
  } catch {
    return false;
  }
}

export function startServer(handlers: Handler[]): void {
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", config.publicUrl);
      try {
        if (url.pathname === "/health" || url.pathname === "/api/health") {
          const health = await healthReply();
          sendJson(res, health.status, health.body);
        } else if (!databaseReady()) {
          sendJson(res, 503, { status: "starting" });
        } else if (url.pathname.startsWith("/api/")) {
          await handleApi(req, res, url, handlers);
        } else if (await serveAsset(res, url.pathname)) {
          return;
        } else {
          await servePage(req, res, url);
        }
      } catch (error) {
        sendFailure(res, error);
      }
    })();
  });
  server.listen(config.port, config.host);
}
