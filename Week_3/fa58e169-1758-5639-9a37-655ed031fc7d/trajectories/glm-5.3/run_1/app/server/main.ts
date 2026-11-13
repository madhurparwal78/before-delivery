import { registerTesterRoutes } from "./testers";
import { registerGradingRoutes } from "./grading";
import { makeMailer } from "./mail/mailer";

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createRequire } from "node:module";
import { env, db } from "../common/env";
import { currentUser, send, type SessionUser } from "./http";
import { routes, liveHub, applySchema, ApiError } from "./routes";
import type { RouteMatch } from "./routes";

const clientDir = join(dirname(fileURLToPath(import.meta.url)), "..", "client");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

function serveStatic(res: http.ServerResponse, file: string): boolean {
  const full = join(clientDir, file);
  if (!existsSync(full)) return false;
  const body = readFileSync(full);
  const type = mimeTypes[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
  return true;
}

import { registerVersionRoutes } from "./versions";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws") as {
  WebSocketServer: new (options: { noServer: boolean }) => {
    on(event: "connection", listener: (ws: unknown, request: unknown) => void): void;
    handleUpgrade(request: unknown, socket: unknown, head: unknown, callback: (ws: unknown) => void): void;
  };
};

const mailer = makeMailer();
const hub = liveHub();

registerVersionRoutes({ hub });
registerTesterRoutes({ hub, mailer });
registerGradingRoutes({ mailer, hub });

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?")[0]!;
    for (const entry of routes) {
      if (entry.method !== method) continue;
      const match = entry.pattern.exec(path);
      if (!match) continue;
      let user: SessionUser | null = null;
      if (entry.needsUser) {
        user = await currentUser(req);
        if (!user) {
          send(res, 401, { error: "unauthenticated" });
          return;
        }
      } else {
        user = await currentUser(req);
      }
      const params: Record<string, string> = {};
      (match as unknown as { params?: Record<string, string> }).params = params;
      const handled = await entry.handler(req, res, match as unknown as RouteMatch, user);
      if (handled) return;
    }
    if (method === "GET") {
      if (path === "/app.js" || path === "/app.css" || path.startsWith("/fonts/")) {
        if (serveStatic(res, path.slice(1))) return;
      }
      if (!path.startsWith("/api/")) {
        if (serveStatic(res, "index.html")) return;
      }
    }
    send(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof ApiError) {
      send(res, error.status, error.payload);
      return;
    }
    if (error instanceof Error && (error.message === "valkey unavailable" || error.message === "valkey timeout")) {
      send(res, 503, { error: "valkey_unavailable" });
      return;
    }
    send(res, 500, { error: "server_error" });
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request: unknown, socket: unknown, head: unknown) => {
  const req = request as { url?: string; headers: { cookie?: string } };
  const path = (req.url ?? "/").split("?")[0]!;
  const match = /^\/api\/patterns\/([^/]+)\/live$/.exec(path);
  if (!match) {
    (socket as { destroy(): void }).destroy();
    return;
  }
  void (async () => {
    const user = await currentUser(req as never);
    if (!user) {
      (socket as { destroy(): void }).destroy();
      return;
    }
    const patternId = match[1]!;
    const access = await patternAccessFor(user, patternId);
    if (!access) {
      (socket as { destroy(): void }).destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const socketLike = ws as {
        send(data: string): void;
        close(): void;
        on(event: string, listener: (data?: unknown) => void): void;
      };
      socketLike.on("close", () => hub.removeSocket(patternId, socketLike));
      socketLike.on("message", (data) => {
        const text = typeof data === "string" ? data : String(data);
        try {
          const message = JSON.parse(text) as Record<string, unknown>;
          if (message.type === "cursor") {
            hub.publishCursor(patternId, user.id, user.name, {
              row: Number(message.row ?? 1),
              col: Number(message.col ?? 1),
            });
          }
        } catch {
          // socket messages are private to the app; anything unparsable is dropped
        }
      });
      hub.addSocket(patternId, user.id, user.name, socketLike);
      socketLike.send(
        JSON.stringify({ type: "hello", live: hub.up(), presence: hub.presenceOf(patternId) }),
      );
    });
  })();
});

async function patternAccessFor(user: SessionUser, patternId: string): Promise<boolean> {
  const { sql } = await import("../common/env");
  const pattern = await sql<{ owner_id: string }>(`SELECT owner_id FROM patterns WHERE id = $1`, [patternId]);
  const row = pattern[0];
  if (!row) return false;
  if (row.owner_id === user.id) return true;
  const co = await sql<{ user_id: string }>(
    `SELECT user_id FROM co_designers WHERE pattern_id = $1 AND user_id = $2`,
    [patternId, user.id],
  );
  if (co.length > 0) return true;
  const tester = await sql<{ user_id: string }>(
    `SELECT user_id FROM testers WHERE pattern_id = $1 AND user_id = $2`,
    [patternId, user.id],
  );
  return tester.length > 0;
}

async function start(): Promise<void> {
  await applySchema();
  server.listen(env.port, "0.0.0.0", () => {
    console.log(`twinrow on ${env.port}`);
  });
}

void start();

process.on("SIGTERM", () => {
  void db.end().finally(() => process.exit(0));
});
