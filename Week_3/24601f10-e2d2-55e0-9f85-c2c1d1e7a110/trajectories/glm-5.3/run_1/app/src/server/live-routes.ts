import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer, WebSocket } from "ws";
import { URL } from "node:url";
import { userFromRequest } from "./auth.js";
import * as T from "./tournaments.js";
import { addClient, removeClient, replayFrom, shapeFor, type LiveClient } from "./live.js";

interface LiveSocketState {
  tournamentId: string;
  isOrganizer: boolean;
  isShare: boolean;
  socket: WebSocket;
}

const sockets = new Set<LiveSocketState>();

export async function handleLiveUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  url: URL
): Promise<void> {
  const match = url.pathname.match(/^\/api\/tournaments\/([^/]+)\/live$/);
  if (!match) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  const tid = match[1]!;
  const t = await T.getTournamentRow(tid);
  if (!t) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  let isOrganizer = false;
  let user = null;
  const shareCode = url.searchParams.get("share");
  if (shareCode) {
    if (t.share_code !== shareCode || t.state === "draft") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
  } else {
    user = await userFromRequest(req);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const role = await T.myRole(t, user.id);
    if (t.state === "draft" && role !== "organizer" && role !== "co_organizer") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    isOrganizer = role === "organizer" || role === "co_organizer";
  }
  const afterRaw = url.searchParams.get("after");
  const after = afterRaw ? Number(afterRaw) : 0;

  wss.handleUpgrade(req, socket, head, (ws) => {
    const state: LiveSocketState = {
      tournamentId: tid,
      isOrganizer,
      isShare: Boolean(shareCode),
      socket: ws,
    };
    sockets.add(state);
    const client: LiveClient = {
      id: `${tid}:${Math.random()}`,
      tournamentId: tid,
      isOrganizer,
      isShare: Boolean(shareCode),
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(shapeFor(client, msg)));
      },
    };
    // catch-up first: replay every message with a higher seq, then continue live,
    // so no live message overtakes the replay
    replayFrom(tid, after, (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(shapeFor(client, msg)));
    })
      .then(() => {
        addClient(client);
      })
      .catch(() => {
        /* ignore replay failure */
      });
    ws.on("close", () => {
      sockets.delete(state);
      removeClient(client);
    });
    ws.on("message", (data) => {
      void data;
    });
  });
}

/** Closing sockets on a replaced share link: close code 4404, reason link_replaced. */
export async function closeShareSockets(tournamentId: string): Promise<void> {
  for (const s of sockets) {
    if (s.tournamentId === tournamentId && s.isShare) {
      s.socket.close(4404, "link_replaced");
      sockets.delete(s);
    }
  }
}
