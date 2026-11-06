import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { Services } from "./services.js";
import { currentUser, parseCookies } from "./auth.js";
import { ApiError } from "./errors.js";
import type { Member } from "../shared/types.js";
import { membersOf } from "./api/members.js";

interface FrameSink {
  userId: string;
  projectId: string;
  send: (frame: string) => void;
}

export class ProjectBus {
  private sinks = new Map<WebSocket, FrameSink>();
  private wss: WebSocketServer | null = null;

  attach(server: HttpServer, svc: Services): void {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 2_000_000 });
    server.on("upgrade", async (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://internal");
      const m = url.pathname.match(/^\/api\/projects\/([^/]+)\/socket$/);
      if (!m) {
        socket.destroy();
        return;
      }
      const projectId = m[1] as string;
      const cookies = parseCookies(req.headers.cookie);
      const user = await currentUser(svc.pool, cookies["rb_session"] ?? null);
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const member = await svc.pool.query(
        `SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2`,
        [projectId, user.id],
      );
      if ((member.rowCount ?? 0) === 0) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        void this.onConnection(ws, svc, projectId, user.id);
      });
    });
  }

  private async onConnection(ws: WebSocket, svc: Services, projectId: string, userId: string): Promise<void> {
    this.sinks.set(ws, {
      userId,
      projectId,
      send: (frame) => {
        if (ws.readyState === ws.OPEN) ws.send(frame);
      },
    });
    const session = await svc.pool.query(
      `SELECT id, project_id, title, state, scheduled_for, driver_id, version FROM sessions
       WHERE project_id = $1 AND state IN ('live','paused') ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    );
    const helloSession = (session.rowCount ?? 0) > 0 ? rowToSession(session.rows[0]) : null;
    const participants = await this.onlineMembers(svc, projectId);
    ws.send(JSON.stringify({ type: "hello", you: userId, session: helloSession, participants }));
    this.publish(projectId, { type: "presence", participants: await this.onlineMembers(svc, projectId) });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      void this.onMessage(ws, svc, projectId, userId, data.toString("utf8"));
    });
    ws.on("close", () => {
      this.sinks.delete(ws);
      void this.republishPresence(svc, projectId);
    });
    ws.on("error", () => {
      this.sinks.delete(ws);
    });
  }

  private async onMessage(ws: WebSocket, svc: Services, projectId: string, userId: string, text: string): Promise<void> {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = frame["type"];
    if (type === "cursor") {
      this.publishExcept(ws, projectId, {
        type: "cursor",
        user_id: userId,
        file_id: frame["file_id"],
        path: frame["path"],
        line: frame["line"],
        column: frame["column"],
      });
      return;
    }
    if (type === "edit") {
      try {
        const result = await svc.files.saveFile(
          projectId,
          { id: userId, name: "", email: null, kind: "learner" },
          String(frame["file_id"] ?? ""),
          String(frame["content"] ?? ""),
          Number(frame["base_revision"] ?? 0),
        );
        this.publish(projectId, { type: "file", file: result.file });
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "validation";
        const current = e instanceof ApiError && e.code === "stale_revision" ? e.extra["current_revision"] : undefined;
        this.sendTo(ws, projectId, {
          type: "edit_rejected",
          file_id: frame["file_id"],
          code,
          current_revision: current,
        });
      }
      return;
    }
  }

  publish(projectId: string, frame: Record<string, unknown>): void {
    const text = JSON.stringify(frame);
    for (const [, sink] of this.sinks) {
      if (sink.projectId === projectId) sink.send(text);
    }
  }

  private publishExcept(ws: WebSocket, projectId: string, frame: Record<string, unknown>): void {
    const text = JSON.stringify(frame);
    for (const [socket, sink] of this.sinks) {
      if (socket === ws) continue;
      if (sink.projectId === projectId) sink.send(text);
    }
  }

  private sendTo(ws: WebSocket, _projectId: string, frame: Record<string, unknown>): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  }

  closeSockets(projectId: string, userId: string, code: number, reason: string): void {
    for (const [ws, sink] of this.sinks) {
      if (sink.projectId === projectId && sink.userId === userId) {
        ws.send(JSON.stringify({ type: "access_revoked" }));
        ws.close(code, reason);
        this.sinks.delete(ws);
      }
    }
  }

  async onlineMembers(svc: Services, projectId: string): Promise<Member[]> {
    const members = await membersOf(svc.pool, projectId);
    const online = new Set<string>();
    for (const [, sink] of this.sinks) {
      if (sink.projectId === projectId) online.add(sink.userId);
    }
    return members.map((m) => ({ ...m, online: online.has(m.user_id) }));
  }

  private async republishPresence(svc: Services, projectId: string): Promise<void> {
    const participants = await this.onlineMembers(svc, projectId);
    this.publish(projectId, { type: "presence", participants });
  }

  onlineFor(projectId: string): string[] {
    const out: string[] = [];
    for (const [, sink] of this.sinks) {
      if (sink.projectId === projectId) out.push(sink.userId);
    }
    return out;
  }
}

function rowToSession(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row["id"],
    project_id: row["project_id"],
    title: row["title"],
    state: row["state"],
    scheduled_for: (row["scheduled_for"] as Date).toISOString(),
    driver_id: row["driver_id"],
    version: row["version"],
  };
}
