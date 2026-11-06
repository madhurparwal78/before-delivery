import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { ApiError, unexpected } from "../shared/errors.js";
import type { ClientMessage, Role, ServerMessage } from "../shared/types.js";
import { roleIn } from "./access.js";
import { currentUser, type User } from "./auth.js";
import { config } from "./config.js";
import { fromOtherOrigin } from "./http.js";
import { submit } from "./ops.js";
import { loadDoc } from "./workspaces.js";

interface Session {
  ws: WebSocket;
  user: User;
  role: Role;
  workspaceId: string;
  pageId: string | null;
  lastBeat: number;
  queue: Promise<void>;
}

const sessions = new Map<string, Set<Session>>();

function send(session: Session, message: ServerMessage): void {
  if (session.ws.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify(message));
}

function inWorkspace(workspaceId: string): Session[] {
  return [...(sessions.get(workspaceId) ?? [])];
}

export function broadcast(workspaceId: string, message: ServerMessage, except?: Session): void {
  for (const session of inWorkspace(workspaceId)) if (session !== except) send(session, message);
}

export function sendToUser(workspaceId: string, userId: string, message: ServerMessage): void {
  for (const session of inWorkspace(workspaceId)) if (session.user.id === userId) send(session, message);
}

function presence(workspaceId: string): void {
  const people: { id: string; name: string; role: Role }[] = [];
  for (const s of inWorkspace(workspaceId)) if (!people.some((p) => p.id === s.user.id)) people.push({ id: s.user.id, name: s.user.name, role: s.role });
  broadcast(workspaceId, { type: "presence", people });
}

/** A role change reaches the member's open sessions at once. */
export function roleChanged(workspaceId: string, userId: string, role: Role): void {
  for (const session of inWorkspace(workspaceId)) {
    if (session.user.id !== userId) continue;
    session.role = role;
    send(session, { type: "role", role });
  }
  presence(workspaceId);
}

/** Removal closes the member's connections with 4404. */
export function memberRemoved(workspaceId: string, userId: string): void {
  for (const session of inWorkspace(workspaceId)) if (session.user.id === userId) session.ws.close(4404, "Not found.");
}

function drop(session: Session): void {
  const set = sessions.get(session.workspaceId);
  if (!set?.delete(session)) return;
  if (!set.size) sessions.delete(session.workspaceId);
  presence(session.workspaceId);
}

function handle(session: Session, raw: string): void {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }
  if (message.type === "cursor") {
    session.pageId = typeof message.pageId === "string" ? message.pageId : null;
    const x = typeof message.x === "number" ? message.x : null;
    const y = typeof message.y === "number" ? message.y : null;
    broadcast(session.workspaceId, { type: "cursor", userId: session.user.id, name: session.user.name, pageId: session.pageId ?? "", x, y }, session);
  } else if (message.type === "select") {
    broadcast(session.workspaceId, { type: "selection", userId: session.user.id, nodeId: typeof message.nodeId === "string" ? message.nodeId : null }, session);
  } else if (message.type === "op") {
    const op = message.op ?? {};
    const opId = typeof op.opId === "string" ? op.opId : "";
    session.queue = session.queue.then(async () => {
      try {
        const ack = await submit(session.user, session.workspaceId, op);
        send(session, { type: "ack", ...ack });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && error.code === "not_found" && !(await roleIn(session.workspaceId, session.user.id))) {
          session.ws.close(4404, "Not found.");
          return;
        }
        const e = error instanceof ApiError ? error : unexpected();
        if (!(error instanceof ApiError)) console.error(error);
        send(session, { type: "reject", opId, error: { code: e.code, message: e.message } });
      }
    });
  }
}

async function accept(ws: WebSocket, req: IncomingMessage, workspaceId: string): Promise<void> {
  const user = await currentUser(req);
  if (!user) return void ws.close(4401, "Sign in to continue.");
  const role = await roleIn(workspaceId, user.id);
  if (!role) return void ws.close(4404, "Not found.");
  const session: Session = { ws, user, role, workspaceId, pageId: null, lastBeat: Date.now(), queue: Promise.resolve() };
  const set = sessions.get(workspaceId) ?? new Set<Session>();
  sessions.set(workspaceId, set);
  set.add(session);
  ws.on("pong", () => (session.lastBeat = Date.now()));
  ws.on("message", (data) => {
    session.lastBeat = Date.now();
    handle(session, data.toString());
  });
  ws.on("close", () => drop(session));
  ws.on("error", () => drop(session));
  const { seq } = await loadDoc(workspaceId);
  send(session, { type: "hello", seq, you: { id: user.id, name: user.name, role } });
  presence(workspaceId);
}

export function attachLive(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname !== "/ws" || fromOtherOrigin(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const workspaceId = url.searchParams.get("workspace") ?? "";
    wss.handleUpgrade(req, socket, head, (ws) => {
      accept(ws, req, workspaceId).catch((error) => {
        console.error(error);
        ws.close(1011, "Something went wrong.");
      });
    });
  });
  setInterval(() => {
    const now = Date.now();
    for (const set of sessions.values())
      for (const session of [...set]) {
        if (now - session.lastBeat > config.presenceTimeoutMs) {
          session.ws.terminate();
          drop(session);
        } else if (session.ws.readyState === WebSocket.OPEN) session.ws.ping();
      }
  }, 1000).unref();
}
