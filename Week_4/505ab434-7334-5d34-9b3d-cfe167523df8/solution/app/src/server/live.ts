// The live channel: PostgreSQL NOTIFY carries every committed change to the WebSocket of every app instance.
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import pg from "pg";
import { WebSocket, WebSocketServer } from "ws";
import { config } from "./config.ts";
import { principalForSession } from "./auth.ts";
import { foreignOrigin, parseCookies } from "./http.ts";
import type { Audience } from "./db.ts";
import type { LiveMessage, Principal } from "../shared/api.ts";

interface Peer {
  socket: WebSocket;
  principal: Principal;
}

const peers = new Set<Peer>();

function hears(audience: Audience, principal: Principal): boolean {
  return Boolean(audience.all || audience.roles?.includes(principal.role) || audience.principals?.includes(principal.id));
}

function fanOut(message: LiveMessage, audience: Audience): void {
  const text = JSON.stringify(message);
  for (const peer of peers) {
    if (peer.socket.readyState === WebSocket.OPEN && hears(audience, peer.principal)) peer.socket.send(text);
  }
}

async function listen(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  let retrying = false;
  const retry = (): void => {
    if (retrying) return;
    retrying = true;
    setTimeout(() => void listen(), 2000);
  };
  client.on("error", retry);
  client.on("end", retry);
  client.on("notification", (note) => {
    if (note.payload) {
      const { message, audience } = JSON.parse(note.payload) as { message: LiveMessage; audience: Audience };
      fanOut(message, audience);
    }
  });
  try {
    await client.connect();
    await client.query("LISTEN live");
  } catch {
    retry();
  }
}

function refuse(socket: Duplex, status: number, code: string, message: string): void {
  const body = JSON.stringify({ error: code, message });
  socket.end(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
}

export function startLive(server: Server): void {
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/api/live") {
      socket.destroy();
      return;
    }
    void (async () => {
      const principal = await principalForSession(parseCookies(req.headers.cookie)[config.sessionCookieName]);
      if (!principal) return refuse(socket, 401, "unauthenticated", "Sign in to continue.");
      if (foreignOrigin(req.headers.origin, req.headers.host)) return refuse(socket, 403, "cross_origin", "Requests must come from this site.");
      sockets.handleUpgrade(req, socket, head, (ws) => {
        const peer = { socket: ws, principal };
        peers.add(peer);
        ws.on("close", () => peers.delete(peer));
        ws.on("error", () => peers.delete(peer));
      });
    })();
  });
  void listen();
}
