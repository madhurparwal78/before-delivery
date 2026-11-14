import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { config } from "./config.ts";
import { ApiError } from "./errors.ts";
import { seatPresence } from "./exercise.ts";
import { cookieOf } from "./http.ts";
import { userFromCookie } from "./auth.ts";
import { hasOtherConnection, register, sendTo, unregister, type Connection } from "./live.ts";
import { accessSessionFor, currentPayload, mutate } from "./sessions.ts";

const LIVE = /^\/api\/sessions\/([^/]+)\/live$/;

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** The WebSocket of a session: same origin only, signed in by the session cookie. */
export function attachSockets(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const match = LIVE.exec(url.pathname);
      if (!match) return refuse(socket, "404 Not Found");
      const origin = req.headers.origin;
      if (origin !== undefined && new URL(origin).host !== req.headers.host) return refuse(socket, "403 Forbidden");
      const sessionId = decodeURIComponent(match[1] ?? "");
      try {
        const user = await userFromCookie((name) => cookieOf(req, name));
        if (!user) return refuse(socket, "401 Unauthorized");
        await accessSessionFor(user, sessionId);
        wss.handleUpgrade(req, socket, head, (ws) => {
          const connection: Connection = { socket: ws, sessionId, userId: user.id, queue: [] };
          register(connection);
          ws.on("close", () => {
            unregister(connection);
            if (!hasOtherConnection(sessionId, user.id)) void seatPresence(sessionId, user.id, false).then(() => scheduleGrace(sessionId));
          });
          ws.on("error", () => ws.close());
          void seatPresence(sessionId, user.id, true).then(async () => {
            const current = await currentPayload(sessionId);
            if (current && ws.readyState === ws.OPEN) sendTo(connection, current.payload);
          });
        });
      } catch (error) {
        refuse(socket, error instanceof ApiError ? "404 Not Found" : "500 Internal Server Error");
      }
    })();
  });
}

/** Pushes once more when a disconnected seat's grace runs out, so the console can offer its Reassign button. */
function scheduleGrace(sessionId: string): void {
  setTimeout(() => {
    void mutate(sessionId, () => undefined).catch(() => undefined);
  }, config.seatGraceSeconds * 1000 + 200);
}
