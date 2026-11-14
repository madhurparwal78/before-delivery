import { STATUS_CODES, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { AccessReason, Role } from "../shared/access.js";
import type { Layout } from "../shared/layout.js";
import { ACCESS_CLOSE_CODE, type Author, type LiveMessage } from "../shared/live.js";
import { SESSION_COOKIE, userForSession, type User } from "./auth.js";
import { config } from "./config.js";
import { transaction } from "./db.js";
import { ApiError, fail } from "./errors.js";
import { parseCookies } from "./http.js";
import { activeShare, loadProject, projectAccess } from "./project-store.js";

interface Connection {
  socket: WebSocket;
  projectId: string;
  user: User | null;
  shareId: string | null;
  shareExpiresAt: number | null;
  access: Role;
  joinedAt: number;
  lastSeen: number;
}

const connections = new Map<string, Set<Connection>>();
const wss = new WebSocketServer({ noServer: true });

function send(connection: Connection, message: LiveMessage): void {
  if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(JSON.stringify(message));
}

function projectConnections(projectId: string): Connection[] {
  return [...(connections.get(projectId) ?? [])];
}

function broadcast(projectId: string, message: LiveMessage): void {
  for (const connection of projectConnections(projectId)) send(connection, message);
}

function presence(projectId: string): void {
  const list = projectConnections(projectId).sort((a, b) => a.joinedAt - b.joinedAt);
  const people: Author[] = [];
  const seen = new Set<string>();
  let linkViewers = 0;
  for (const connection of list) {
    if (!connection.user) {
      linkViewers++;
      continue;
    }
    if (seen.has(connection.user.id)) continue;
    seen.add(connection.user.id);
    people.push({ userId: connection.user.id, displayName: connection.user.displayName });
  }
  broadcast(projectId, { type: "presence", people, linkViewers });
}

function remove(connection: Connection): void {
  const set = connections.get(connection.projectId);
  if (!set || !set.delete(connection)) return;
  if (set.size === 0) connections.delete(connection.projectId);
  presence(connection.projectId);
}

function endAccess(connection: Connection, reason: AccessReason): void {
  send(connection, { type: "access", access: "none", reason });
  connection.socket.close(ACCESS_CLOSE_CODE, reason);
  remove(connection);
}

export const live = {
  revision(projectId: string, revision: number, text: string, by: User): void {
    broadcast(projectId, { type: "revision", revision, text, by: { userId: by.id, displayName: by.displayName } });
  },
  layout(projectId: string, layout: Layout, by: User): void {
    broadcast(projectId, { type: "layout", layout, by: { userId: by.id, displayName: by.displayName } });
  },
  /** A member's role changed, or (with null) they lost access. */
  member(projectId: string, userId: string, role: "editor" | "viewer" | null, reason: AccessReason): void {
    for (const connection of projectConnections(projectId)) {
      if (connection.shareId || connection.user?.id !== userId) continue;
      if (role === null) endAccess(connection, reason);
      else {
        connection.access = role;
        send(connection, { type: "access", access: role, reason });
      }
    }
  },
  shareEnded(projectId: string, shareId: string, reason: "revoked" | "rotated"): void {
    for (const connection of projectConnections(projectId)) if (connection.shareId === shareId) endAccess(connection, reason);
  },
};

function refuse(socket: Duplex, error: ApiError): void {
  const body = JSON.stringify(error.body);
  socket.write(
    `HTTP/1.1 ${error.status} ${STATUS_CODES[error.status]}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
  socket.destroy();
}

function originMatches(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function admit(req: IncomingMessage): Promise<Omit<Connection, "socket" | "joinedAt" | "lastSeen"> & { hello: LiveMessage }> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const projectMatch = /^\/api\/projects\/([^/]+)\/live$/.exec(url.pathname);
  const sharedMatch = /^\/api\/shared\/([^/]+)\/live$/.exec(url.pathname);
  if (projectMatch) {
    const user = await userForSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!user) throw fail.signedOut();
    const { project, role } = await transaction((db) => projectAccess(db, decodeURIComponent(projectMatch[1]!), user));
    return {
      projectId: project.id,
      user,
      shareId: null,
      shareExpiresAt: null,
      access: role,
      hello: hello(project.revision, project.text, project.layout, role),
    };
  }
  if (sharedMatch) {
    const result = await transaction(async (db) => {
      const share = await activeShare(db, decodeURIComponent(sharedMatch[1]!));
      if (!share || share.access !== "view") throw fail.notFound();
      const project = await loadProject(db, share.project_id);
      if (!project) throw fail.notFound();
      return { share, project };
    });
    return {
      projectId: result.project.id,
      user: null,
      shareId: result.share.id,
      shareExpiresAt: result.share.expires_at.getTime(),
      access: "viewer",
      hello: hello(result.project.revision, result.project.text, result.project.layout, "viewer"),
    };
  }
  throw fail.notFound();
}

function hello(revision: number, text: string, layout: Layout, access: Role): LiveMessage {
  return { type: "hello", revision, text, layout, access, presenceTimeoutSeconds: config.presenceTimeoutSeconds };
}

export function attachLive(server: Server): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!originMatches(req)) {
      refuse(socket, fail.badOrigin());
      return;
    }
    admit(req)
      .then((admitted) => {
        wss.handleUpgrade(req, socket, head, (socketWs) => {
          const now = Date.now();
          const { hello: first, ...rest } = admitted;
          const connection: Connection = { ...rest, socket: socketWs, joinedAt: now, lastSeen: now };
          if (!connections.has(connection.projectId)) connections.set(connection.projectId, new Set());
          connections.get(connection.projectId)!.add(connection);
          socketWs.on("message", () => {
            connection.lastSeen = Date.now();
          });
          socketWs.on("close", () => remove(connection));
          socketWs.on("error", () => remove(connection));
          send(connection, first);
          presence(connection.projectId);
        });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError) refuse(socket, error);
        else {
          console.error(error);
          refuse(socket, fail.server());
        }
      });
  });

  setInterval(() => {
    const now = Date.now();
    for (const set of connections.values()) {
      for (const connection of [...set]) {
        if (connection.shareExpiresAt !== null && now >= connection.shareExpiresAt) {
          endAccess(connection, "expired");
        } else if (now - connection.lastSeen > config.presenceTimeoutSeconds * 1000) {
          connection.socket.terminate();
          remove(connection);
        }
      }
    }
  }, 1000).unref();
}
