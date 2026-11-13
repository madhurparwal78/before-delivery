import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { ApiError } from "./errors";
import * as hub from "./hub";
import { parseCookies, sameOrigin } from "./http";
import { joinedMatch, leftMatch, parseShotBody, preview, resign, sendEmote, setReady, submitShot } from "./matches";
import { playerById, playerBySession } from "./players";
import { rematch } from "./rooms";

/** GET /ws upgrades on the same origin; /ws?match=<id> also joins that match. */

const MAX_MESSAGE_BYTES = 16384;
const TAB_TOKEN = /^[A-Za-z0-9-]{8,64}$/;

async function handleMessage(connection: hub.Connection, message: Record<string, unknown>): Promise<void> {
  connection.lastHeard = Date.now();
  const matchId = connection.matchId;
  if (message.type === "pong" || !matchId) return;
  const who = connection.playerId;
  try {
    switch (message.type) {
      case "ready":
        await setReady(who, matchId);
        break;
      case "place":
      case "aim":
        await preview(who, matchId, message);
        break;
      case "shoot":
        await submitShot(who, matchId, parseShotBody(message));
        break;
      case "emote":
        await sendEmote(who, matchId, message.emote);
        break;
      case "resign":
        await resign(who, matchId);
        break;
      case "rematch": {
        const player = await playerById(who);
        if (player && typeof message.accept === "boolean") await rematch(player, matchId, message.accept);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    hub.send(connection, { type: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
  }
}

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachSockets(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws") return refuse(socket, "404 Not Found");
    if (!sameOrigin(req)) return refuse(socket, "403 Forbidden");
    const token = parseCookies(req.headers.cookie).dc_session;
    if (!token) return refuse(socket, "401 Unauthorized");
    playerBySession(token).then(
      (player) => {
        if (!player) return refuse(socket, "401 Unauthorized");
        wss.handleUpgrade(req, socket, head, (ws) => open(ws, player.id, url.searchParams.get("match"), url.searchParams.get("token")));
      },
      () => refuse(socket, "503 Service Unavailable"),
    );
  });
}

function open(socket: WebSocket, playerId: string, matchId: string | null, token: string | null): void {
  const tabToken = token !== null && TAB_TOKEN.test(token) ? token : null;
  const connection: hub.Connection = { socket, playerId, matchId, tabToken, lastHeard: Date.now() };
  hub.addConnection(connection);
  socket.on("message", (data) => {
    try {
      const parsed: unknown = JSON.parse(data.toString());
      if (typeof parsed === "object" && parsed !== null) void handleMessage(connection, parsed as Record<string, unknown>);
    } catch {
      hub.send(connection, { type: "error", code: "INVALID_PAYLOAD" });
    }
  });
  socket.on("close", () => {
    hub.removeConnection(connection);
    void leftMatch(connection).catch(() => undefined);
  });
  socket.on("error", () => socket.terminate());
  void joinedMatch(connection).catch(() => undefined);
}
