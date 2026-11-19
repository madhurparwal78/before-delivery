// Live channel hub. A same-origin WebSocket at /api/w/<workspaceId>/live pushes
// every workspace event to signed-in members; the upgrade is refused otherwise.

import { createHash } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import type { Db } from "./db.js";

export interface LiveEvent {
  kind: string;
  body: Record<string, unknown>;
}

interface LiveSocket {
  workspaceId: string;
  personId: string;
  send: (event: LiveEvent) => void;
  close: () => void;
}

export class LiveHub {
  private sockets: LiveSocket[] = [];
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  register(socket: LiveSocket): void {
    this.sockets.push(socket);
  }

  unregister(socket: LiveSocket): void {
    this.sockets = this.sockets.filter((s) => s !== socket);
  }

  /** Pushes an event to every member of the workspace with a socket open. */
  publish(workspaceId: string, event: LiveEvent): void {
    for (const socket of this.sockets) {
      if (socket.workspaceId === workspaceId) {
        socket.send(event);
      }
    }
  }

  async isMember(personId: string, workspaceId: string): Promise<boolean> {
    const row = await this.db.one<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM memberships WHERE person_id = $1 AND workspace_id = $2) AS exists`,
      [personId, workspaceId],
    );
    return row?.exists === true;
  }
}

export function attachWebSocket(
  server: HttpServer,
  db: Db,
  hub: LiveHub,
): void {
  server.on("upgrade", (request, socket, head) => {
    if (!request.url) {
      socket.destroy();
      return;
    }
    void (async () => {
      const url = new URL(request.url!, "http://localhost");
      const match = url.pathname.match(/^\/api\/w\/([^/]+)\/live$/);
      const sessionCookie = request.headers.cookie ?? "";
      const token = readSessionToken(sessionCookie);
      if (!match || !token) {
        socket.destroy();
        return;
      }
      const session = await db.one<{ person_id: string }>(
        `SELECT person_id FROM sessions WHERE token = $1`,
        [token],
      );
      if (!session) {
        socket.destroy();
        return;
      }
      const workspaceId = match[1]!;
      const member = await db.one<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM memberships WHERE person_id = $1 AND workspace_id = $2) AS exists`,
        [session.person_id, workspaceId],
      );
      if (!member?.exists) {
        socket.destroy();
        return;
      }
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${secWebSocketAccept(String(request.headers["sec-websocket-key"] ?? ""))}\r\n` +
          "\r\n",
      );
      socket.write(head);
      const liveSocket: LiveSocket = {
        workspaceId,
        personId: session.person_id,
        send: (event) => {
          const payload = Buffer.from(JSON.stringify(event), "utf8");
          const frame = encodeFrame(payload);
          socket.write(frame);
        },
        close: () => socket.destroy(),
      };
      hub.register(liveSocket);
      socket.on("data", (buffer) => {
        // Client frames are ignored; only server pushes matter.
        if (isCloseFrame(buffer)) {
          hub.unregister(liveSocket);
          socket.destroy();
        }
      });
      socket.on("close", () => hub.unregister(liveSocket));
      socket.on("error", () => hub.unregister(liveSocket));
    })();
  });
}

function readSessionToken(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "fs_session" && rest.length > 0) {
      return rest.join("=");
    }
  }
  return null;
}

export function secWebSocketAccept(clientKey: string): string {
  const magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  return createHash("sha1").update(clientKey + magic).digest("base64");
}

function encodeFrame(payload: Buffer): Buffer {
  const length = payload.length;
  if (length < 126) {
    const header = Buffer.from([0x81, length]);
    return Buffer.concat([header, payload]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function isCloseFrame(buffer: Buffer): boolean {
  return buffer.length > 0 && (buffer[0] & 0x0f) === 0x08;
}
