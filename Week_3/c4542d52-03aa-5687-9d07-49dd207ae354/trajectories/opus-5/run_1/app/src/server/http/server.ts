import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer } from "ws";
import type { Role } from "../../shared/types.js";
import { config } from "../config.js";
import { db, isRegisterReady } from "../db.js";
import { addConnection, sendTo } from "../live/hub.js";
import { audienceMatches, replayEvents } from "../live/events.js";
import { ApiError, errorBody } from "./errors.js";
import { matchRoute, type Route } from "./router.js";
import { personForToken, SESSION_COOKIE, sessionRoutes } from "./routes/session.js";
import { grantRoutes } from "./routes/grants.js";
import { exerciseRoutes } from "./routes/exercises.js";
import { tenderRoutes } from "./routes/tenders.js";
import { documentRoutes } from "./routes/documents.js";
import { adminRoutes } from "./routes/admin.js";
import type { RequestContext } from "./context.js";

const BODY_LIMIT = 65536;
const WEB_ROOT = resolve(process.cwd(), "dist/web");

const routes: Route[] = [
  ...sessionRoutes,
  ...grantRoutes,
  ...exerciseRoutes,
  ...tenderRoutes,
  ...documentRoutes,
  ...adminRoutes,
];

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host ?? "";
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer | ApiError> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > BODY_LIMIT) return new ApiError(413, "payload_too_large", "That request is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string>): void {
  const payload = body === undefined ? "" : JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(payload);
}

function sendError(response: ServerResponse, error: ApiError): void {
  sendJson(response, error.status, errorBody(error), {});
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? "GET";
  if (url.pathname === "/api/health" && method === "GET") {
    sendJson(response, 200, { status: "ok" }, {});
    return;
  }

  const raw = await readBody(request);
  if (raw instanceof ApiError) {
    sendError(response, raw);
    return;
  }
  let body: unknown = undefined;
  if (raw.length > 0) {
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      sendError(response, new ApiError(415, "unsupported_media_type", "Send this request as JSON."));
      return;
    }
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      sendError(response, new ApiError(400, "bad_json", "That request body isn't valid JSON."));
      return;
    }
  }
  if (method !== "GET" && method !== "HEAD" && !sameOrigin(request)) {
    sendError(response, new ApiError(403, "forbidden", "This isn't on your register."));
    return;
  }
  if (!isRegisterReady()) {
    sendError(response, new ApiError(503, "register_unavailable", "The register can't be reached. Try again shortly."));
    return;
  }

  const match = matchRoute(routes, method, url.pathname);
  if (match === null || match === "method_mismatch") {
    sendError(response, new ApiError(404, "not_found", "This record isn't on your register."));
    return;
  }

  const person = await personForToken(cookieValue(request.headers.cookie, SESSION_COOKIE));
  if (!match.route.anonymous && person === null) {
    sendError(response, new ApiError(401, "unauthenticated", "Sign in to see your register."));
    return;
  }

  const context: RequestContext = {
    method,
    path: url.pathname,
    params: match.params,
    query: url.searchParams,
    body,
    headers: request.headers,
    person,
    now: new Date(),
  };
  try {
    const result = await match.route.handler(context);
    if (result.raw !== undefined) {
      response.writeHead(result.status, { "cache-control": "no-store", ...result.headers });
      response.end(result.raw);
      return;
    }
    if (result.status === 204) {
      response.writeHead(204, { "cache-control": "no-store", ...result.headers });
      response.end();
      return;
    }
    sendJson(response, result.status, result.body, result.headers ?? {});
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(response, error);
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendJson(
      response,
      500,
      { error: { code: "server_error", message: "Something went wrong on our side. Your register has not changed." } },
      {},
    );
  }
}

async function serveFile(response: ServerResponse, path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    const bytes = await readFile(path);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
      "cache-control": extname(path) === ".html" ? "no-store" : "public, max-age=3600",
    });
    response.end(bytes);
    return true;
  } catch {
    return false;
  }
}

async function handleStatic(response: ServerResponse, url: URL): Promise<void> {
  const requested = resolve(join(WEB_ROOT, normalize(decodeURIComponent(url.pathname))));
  if (requested.startsWith(WEB_ROOT) && url.pathname !== "/" && (await serveFile(response, requested))) return;
  const lastSegment = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  if (!lastSegment.includes(".") && (await serveFile(response, join(WEB_ROOT, "index.html")))) return;
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end("Not on your register");
}

export function startServer(): void {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const work = url.pathname.startsWith("/api")
      ? handleApi(request, response, url)
      : handleStatic(response, url);
    void work.catch((error: unknown) => {
      process.stderr.write(`request crashed: ${String(error)}\n`);
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          error: { code: "server_error", message: "Something went wrong on our side. Your register has not changed." },
        }),
      );
    });
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/live") {
      socket.destroy();
      return;
    }
    if (!sameOrigin(request)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    void (async () => {
      const person = await personForToken(cookieValue(request.headers.cookie, SESSION_COOKIE));
      if (person === null) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (connection) => {
        addConnection(connection, person.id, person.role as Role);
        const since = Number(url.searchParams.get("since") ?? "0");
        if (Number.isInteger(since) && since > 0) {
          void replayEvents(db, since).then((events) => {
            for (const item of events) {
              if (audienceMatches(item.audience, person.id, person.role as Role)) sendTo(connection, item.event);
            }
          });
        }
        sendTo(connection, {
          seq: 0,
          type: "clock",
          at: new Date().toISOString(),
          data: { server_time: new Date().toISOString() },
        });
      });
    })();
  });

  server.listen(config.port, "0.0.0.0", () => {
    process.stdout.write(`Holdfast Register serving on port ${config.port}\n`);
  });
}
