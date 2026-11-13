import type http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { LiveMessage, Role } from "../shared/types";
import { roleOf, type Actor } from "./access";
import { sessionFromCookie } from "./auth";
import { linkByToken, linkState } from "./links";
import { listOps } from "./oplog";
import { isOwnOrigin } from "./origin";

const CLOSE_SESSION_ENDED = 4401;
const CLOSE_ROLE_CHANGED = 4403;
const CLOSE_LINK_ENDED = 4410;

interface Conn {
  ws: WebSocket;
  actor: Actor | null;
  sessionId: string | null;
  projectId: string | null;
  playhead: number | null;
  review: { linkId: string; expiresAt: number } | null;
}

/** Every open socket: one per page, grouped by what it is subscribed to. */
class Hub {
  private readonly conns = new Set<Conn>();
  private readonly server = new WebSocketServer({ noServer: true });
  upgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    void this.admit(request, socket, head);
  }

  private async admit(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? "/", "http://local");
    if (url.pathname !== "/api/live" || !isOwnOrigin(request.headers.origin, request.headers.host)) {
      socket.write(`HTTP/1.1 ${url.pathname === "/api/live" ? "403 Forbidden" : "404 Not Found"}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("review");
    const session = token ? null : await sessionFromCookie(request.headers.cookie);
    const link = token ? await linkByToken(token) : null;
    if ((!token && !session) || (token && (!link || linkState(link) !== "active"))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.server.handleUpgrade(request, socket, head, (ws) => {
      const conn: Conn = {
        ws,
        actor: session?.actor ?? null,
        sessionId: session?.sessionId ?? null,
        projectId: null,
        playhead: null,
        review: link ? { linkId: link.id, expiresAt: link.expires_at.getTime() } : null,
      };
      this.conns.add(conn);
      ws.on("message", (data) => void this.receive(conn, data.toString()));
      ws.on("close", () => {
        this.conns.delete(conn);
        if (conn.projectId && conn.actor && conn.playhead !== null) this.broadcastPlayhead(conn, null);
      });
      ws.on("error", () => ws.terminate());
    });
  }

  private async receive(conn: Conn, text: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    const body = message as Record<string, unknown>;
    if (body["type"] === "subscribe" && conn.actor && typeof body["project_id"] === "string") {
      const projectId = body["project_id"];
      if (!(await roleOf(projectId, conn.actor))) {
        conn.ws.close(CLOSE_ROLE_CHANGED);
        return;
      }
      conn.projectId = projectId;
      const after = typeof body["after_version"] === "number" ? body["after_version"] : 0;
      for (const op of await listOps(projectId, after)) this.send(conn, { type: "op", ...op });
      for (const other of this.conns) {
        if (other !== conn && other.projectId === projectId && other.playhead !== null && other.actor) {
          this.send(conn, { type: "playhead", person: other.actor.name, frame: other.playhead });
        }
      }
    } else if (body["type"] === "playhead" && conn.projectId && conn.actor && typeof body["frame"] === "number") {
      conn.playhead = body["frame"];
      this.broadcastPlayhead(conn, body["frame"]);
    }
  }

  private broadcastPlayhead(from: Conn, frame: number | null): void {
    if (!from.actor || !from.projectId) return;
    for (const conn of this.conns) {
      if (conn !== from && conn.projectId === from.projectId && conn.actor?.id !== from.actor.id) {
        this.send(conn, { type: "playhead", person: from.actor.name, frame });
      }
    }
  }

  private send(conn: Conn, message: LiveMessage): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(message));
  }

  toProject(projectId: string, message: LiveMessage): void {
    for (const conn of this.conns) if (conn.projectId === projectId) this.send(conn, message);
  }

  toWorkspace(message: LiveMessage): void {
    for (const conn of this.conns) if (conn.actor) this.send(conn, message);
  }

  toOwners(message: LiveMessage): void {
    for (const conn of this.conns) if (conn.actor?.is_owner) this.send(conn, message);
  }

  toReview(linkId: string, message: LiveMessage): void {
    for (const conn of this.conns) if (conn.review?.linkId === linkId) this.send(conn, message);
  }

  /** The person's open sockets for the project hear the new role, are closed with 4403 and get nothing more. */
  roleChanged(projectId: string, personId: string, role: Role | null): void {
    for (const conn of [...this.conns]) {
      if (conn.projectId === projectId && conn.actor?.id === personId) {
        this.send(conn, { type: "role_changed", role });
        this.conns.delete(conn);
        conn.ws.close(CLOSE_ROLE_CHANGED);
      }
    }
  }

  closeSession(sessionId: string): void {
    for (const conn of [...this.conns]) {
      if (conn.sessionId === sessionId) {
        this.conns.delete(conn);
        conn.ws.close(CLOSE_SESSION_ENDED);
      }
    }
  }

  closeLink(linkId: string): void {
    for (const conn of [...this.conns]) {
      if (conn.review?.linkId === linkId) {
        this.conns.delete(conn);
        conn.ws.close(CLOSE_LINK_ENDED);
      }
    }
  }

  /** Closes review sockets whose link has run out on the server clock. */
  sweepExpired(): void {
    const now = Date.now();
    for (const conn of [...this.conns]) {
      if (conn.review && now >= conn.review.expiresAt) {
        this.conns.delete(conn);
        conn.ws.close(CLOSE_LINK_ENDED);
      }
    }
  }

  closeAll(): void {
    for (const conn of this.conns) conn.ws.terminate();
  }
}

export const hub = new Hub();
