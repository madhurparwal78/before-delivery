import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import pg from "pg";
import { WebSocketServer, type WebSocket } from "ws";
import type { LiveMessage } from "../shared/api.ts";
import { config } from "./config.ts";
import { ApiError, notFound } from "./errors.ts";
import { sameOrigin } from "./http.ts";
import { readSession } from "./session.ts";

// One same-origin WebSocket per open page. Every server copy LISTENs on Postgres, so a change made
// through any copy reaches every page (brief: Browser support and performance).

type Internal = { t: "outbox" } | { t: "snapshots" };
const sockets = new Map<WebSocket, string>();

function broadcast(message: LiveMessage): void {
  const text = JSON.stringify(message);
  // Squad and notice changes are private to their manager; everything else concerns every page.
  const only = message.t === "squad" || message.t === "notice" ? message.manager : null;
  for (const [socket, manager] of sockets) {
    if ((only === null || only === manager) && socket.readyState === socket.OPEN) socket.send(text);
  }
}

async function listen(onInternal: (message: Internal) => void): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  client.on("notification", (note) => {
    const message = JSON.parse(note.payload ?? "{}") as LiveMessage | Internal;
    if (message.t === "outbox" || message.t === "snapshots") onInternal(message);
    else broadcast(message);
  });
  client.on("error", () => undefined);
  client.on("end", () => setTimeout(() => void listen(onInternal).catch(retry(onInternal)), 1000));
  await client.connect();
  await client.query("LISTEN elevens");
  // Pages re-read everything after a gap in the channel.
  broadcast({ t: "gameweek" });
}

const retry = (onInternal: (message: Internal) => void) => (error: Error) => {
  console.error("live channel:", error.message);
  setTimeout(() => void listen(onInternal).catch(retry(onInternal)), 1000);
};

export function startLive(server: Server, onInternal: (message: Internal) => void): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const refuse = (error: ApiError) => {
        const body = JSON.stringify(error.body());
        socket.end(`HTTP/1.1 ${error.status} Refused\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
      };
      if (new URL(request.url ?? "/", "http://app.invalid").pathname !== "/live") return refuse(notFound());
      if (!sameOrigin(request)) return refuse(new ApiError(403, "cross_origin", "The live channel only serves this app's own pages."));
      const session = await readSession(request.headers.cookie);
      if (!session) return refuse(new ApiError(401, "unauthenticated", "Sign in first."));
      wss.handleUpgrade(request, socket, head, (ws) => {
        sockets.set(ws, session.managerId);
        ws.on("close", () => sockets.delete(ws));
        ws.on("error", () => sockets.delete(ws));
      });
    })().catch(() => socket.destroy());
  });
  setInterval(() => {
    for (const socket of sockets.keys()) socket.ping();
  }, 25000).unref();
  void listen(onInternal).catch(retry(onInternal));
}
