import { readFile } from "node:fs/promises";
import http from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "./config.js";
import { migrate, one, pool } from "./db.js";
import { ApiError } from "./errors.js";
import { currentRevision, saveFile } from "./files.js";
import { dispatch, FRAME_LIMIT, ok, PRIVATE_HEADERS, route, sameOrigin, sendError, type User, userFromCookie, UUID } from "./http.js";
import { broadcastPresence, join, participants, relayCursor } from "./hub.js";
import { projectRole, SESSION_COLUMNS, type SessionRow, sessionView, userView } from "./views.js";
import { startWorkers } from "./workers.js";
import "./routes/auth.js";
import "./routes/projects.js";
import "./routes/sessions.js";
import "./routes/files.js";
import "./routes/checkpoints.js";
import "./routes/links.js";

route("GET", "/api/health", async () => ok({ status: "ok" }), { auth: false });

const CLIENT = fileURLToPath(new URL("../client/", import.meta.url));
const SIGNED_IN_PAGES = [/^\/$/, new RegExp(`^/projects/${UUID.source.slice(1, -1)}$`)];
const PUBLIC_PAGES = [/^\/sign-in$/, /^\/auth\/verify$/];
const REVIEW_PAGE = /^\/review\/[^/]+$/;
const REVIEW_TITLE = "Checkpoint review — Relay Bench";
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
const SECURITY = { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };

let indexHtml = "";

function page(res: http.ServerResponse, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...SECURITY, ...headers });
  res.end(html);
}

function notFound(res: http.ServerResponse): void {
  sendError(res, new ApiError("not_found"), SECURITY);
}

async function asset(res: http.ServerResponse, pathname: string): Promise<void> {
  const resolved = path.resolve(CLIENT, `.${decodeURIComponent(pathname)}`);
  const type = TYPES[path.extname(resolved)];
  if (!resolved.startsWith(CLIENT) || !type || !/^\/(assets|fonts)\//.test(pathname)) return notFound(res);
  try {
    const body = await readFile(resolved);
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", ...SECURITY });
    res.end(body);
  } catch {
    notFound(res);
  }
}

async function serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://relay-bench.local");
  if (url.pathname.startsWith("/api/")) return dispatch(req, res, url);
  if (req.method !== "GET" && req.method !== "HEAD") return notFound(res);
  if (REVIEW_PAGE.test(url.pathname)) {
    return page(res, indexHtml.replace(/<title>[^<]*<\/title>/, `<title>${REVIEW_TITLE}</title>`), PRIVATE_HEADERS);
  }
  if (PUBLIC_PAGES.some((p) => p.test(url.pathname))) return page(res, indexHtml);
  if (SIGNED_IN_PAGES.some((p) => p.test(url.pathname))) {
    if (!(await userFromCookie(req))) {
      res.writeHead(302, { Location: "/sign-in", ...SECURITY });
      res.end();
      return;
    }
    return page(res, indexHtml);
  }
  return asset(res, url.pathname);
}

function refuseUpgrade(socket: Duplex, error: ApiError): void {
  const body = JSON.stringify(error.body());
  const reason = http.STATUS_CODES[error.status] ?? "Error";
  socket.end(
    `HTTP/1.1 ${error.status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

async function currentSession(projectId: string): Promise<SessionRow | undefined> {
  return one<SessionRow>(
    pool,
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE project_id = $1 ORDER BY
       CASE WHEN state IN ('live', 'paused') THEN 0 WHEN state = 'scheduled' THEN 1 ELSE 2 END,
       CASE WHEN state = 'scheduled' THEN scheduled_for END ASC,
       updated_at DESC LIMIT 1`,
    [projectId],
  );
}

type ClientFrame = { type?: unknown; file_id?: unknown; base_revision?: unknown; content?: unknown; line?: unknown; column?: unknown };

async function onFrame(ws: WebSocket, projectId: string, user: User, frame: ClientFrame): Promise<void> {
  if (typeof frame.file_id !== "string" || !UUID.test(frame.file_id)) return;
  const fileId = frame.file_id;
  if (frame.type === "edit") {
    try {
      await saveFile(projectId, fileId, user.id, frame.content, frame.base_revision);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const code = ["not_driver", "session_paused", "stale_revision"].includes(error.code) ? error.code : "validation";
      const current = typeof error.extra.current_revision === "number" ? error.extra.current_revision : await currentRevision(projectId, fileId);
      ws.send(JSON.stringify({ type: "edit_rejected", file_id: fileId, code, current_revision: current }));
    }
  } else if (frame.type === "cursor") {
    const file = await one<{ path: string }>(pool, "SELECT path FROM files WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL", [
      fileId,
      projectId,
    ]);
    if (!file || !Number.isInteger(frame.line) || !Number.isInteger(frame.column)) return;
    relayCursor(projectId, user.id, { type: "cursor", user_id: user.id, file_id: fileId, path: file.path, line: frame.line, column: frame.column }, ws);
  }
}

const sockets = new WebSocketServer({ noServer: true, maxPayload: FRAME_LIMIT });

async function upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const url = new URL(req.url ?? "/", "http://relay-bench.local");
  const match = new RegExp(`^/api/projects/([^/]+)/socket$`).exec(url.pathname);
  if (!match) return refuseUpgrade(socket, new ApiError("not_found"));
  const user = await userFromCookie(req);
  if (!user) return refuseUpgrade(socket, new ApiError("unauthenticated"));
  const projectId = match[1]!;
  try {
    if (!UUID.test(projectId)) throw new ApiError("not_found");
    await projectRole(pool, projectId, user.id);
    if (!sameOrigin(req)) throw new ApiError("cross_origin");
  } catch (error) {
    return refuseUpgrade(socket, error instanceof ApiError ? error : new ApiError("storage_unavailable"));
  }
  sockets.handleUpgrade(req, socket, head, (ws) => {
    const leave = join(projectId, user.id, ws);
    ws.on("close", leave);
    ws.on("error", () => ws.terminate());
    let queue = Promise.resolve();
    ws.on("message", (data, binary) => {
      if (binary) return;
      let frame: ClientFrame;
      try {
        frame = JSON.parse(data.toString()) as ClientFrame;
      } catch {
        return;
      }
      queue = queue.then(() => onFrame(ws, projectId, user, frame)).catch((error: unknown) => console.error(error));
    });
    void (async () => {
      const session = await currentSession(projectId);
      ws.send(
        JSON.stringify({
          type: "hello",
          you: userView(user),
          session: session ? sessionView(session) : null,
          participants: await participants(projectId),
        }),
      );
      await broadcastPresence(projectId);
    })().catch((error: unknown) => console.error(error));
  });
}

async function connectWithRetry(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate();
      return;
    } catch (error) {
      if (attempt >= 60) throw error;
      console.error("database not ready, retrying:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

await connectWithRetry();
indexHtml = await readFile(path.join(CLIENT, "index.html"), "utf8");
const server = http.createServer((req, res) => {
  serve(req, res).catch((error: unknown) => {
    if (res.headersSent) return res.destroy();
    sendError(res, error, SECURITY);
  });
});
server.on("upgrade", (req, socket, head) => {
  upgrade(req, socket, head).catch((error: unknown) => {
    console.error(error);
    socket.destroy();
  });
});
server.listen(config.port, "0.0.0.0", () => console.log(`Relay Bench listening on 0.0.0.0:${config.port}`));
startWorkers();
