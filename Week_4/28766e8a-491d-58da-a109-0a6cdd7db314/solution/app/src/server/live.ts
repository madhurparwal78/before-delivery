// The live socket at /ws?diagram=<id> (brief: Live socket, Presence, Sessions): operations,
// presence counted per person, cursors, and the 4401 / 4404 / 4503 close codes.
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { ApiError } from "../shared/errors";
import type { DiagramDocument, PresencePerson, Role, ServerMessage } from "../shared/types";
import { diagramAccess } from "./access";
import { SESSION_COOKIE, userForToken, type SessionUser } from "./auth";
import { config } from "./config";
import { pool } from "./db";
import { parseCookies, sameOrigin } from "./http";
import { inOutage, runOperation } from "./operations";

interface Client {
  id: number;
  socket: WebSocket;
  user: SessionUser;
  diagramId: string;
  role: Role;
  lastPong: number;
  ready: boolean;
  backlog: ServerMessage[];
  work: Promise<void>;
}

const CLOSE = { session: 4401, notFound: 4404, outage: 4503 } as const;

const clients = new Map<number, Client>();
let nextClient = 1;

function sendTo(client: Client, message: ServerMessage): void {
  if (!client.ready) {
    client.backlog.push(message);
    return;
  }
  if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(message));
}

function onDiagram(diagramId: string): Client[] {
  return [...clients.values()].filter((c) => c.diagramId === diagramId);
}

/** Sends to every socket on the diagram; the origin socket gets its acknowledgement instead. */
export function broadcast(diagramId: string, message: ServerMessage, origin?: { socketId: number; ack: ServerMessage }): void {
  for (const client of onDiagram(diagramId)) sendTo(client, origin && client.id === origin.socketId ? origin.ack : message);
}

function presence(diagramId: string): PresencePerson[] {
  const people = new Map<string, PresencePerson>();
  for (const c of onDiagram(diagramId)) people.set(c.user.id, { userId: c.user.id, name: c.user.name, role: c.role });
  return [...people.values()];
}

function sendPresence(diagramId: string): void {
  broadcast(diagramId, { type: "presence", people: presence(diagramId) });
}

/** A role change applies to the open screen at once and to every avatar showing that person. */
export function roleChanged(diagramId: string, userId: string, role: Role): void {
  for (const c of onDiagram(diagramId)) {
    if (c.user.id !== userId) continue;
    c.role = role;
    sendTo(c, { type: "role", role });
  }
  sendPresence(diagramId);
}

function closeWhere(test: (c: Client) => boolean, code: number): void {
  for (const c of [...clients.values()]) if (test(c)) c.socket.close(code);
}

export function closeSession(sessionId: string): void {
  closeWhere((c) => c.user.sessionId === sessionId, CLOSE.session);
}

export function closeMember(diagramId: string, userId: string): void {
  closeWhere((c) => c.diagramId === diagramId && c.user.id === userId, CLOSE.notFound);
}

export function closeDiagram(diagramId: string): void {
  closeWhere((c) => c.diagramId === diagramId, CLOSE.outage);
}

function leave(client: Client): void {
  if (!clients.delete(client.id)) return;
  const stillHere = onDiagram(client.diagramId).some((c) => c.user.id === client.user.id);
  if (!stillHere) {
    broadcast(client.diagramId, { type: "cursor_gone", userId: client.user.id });
    sendPresence(client.diagramId);
  }
}

/** Messages the browser sends; the operation itself is checked by runOperation. */
type Received = { type: "cursor"; page: string; x: number; y: number } | { type: "op"; opId: string; baseSeq: number; op: unknown };

/** A received socket message, checked field by field; null when it is not one. */
function parseMessage(raw: string): Received | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type === "cursor" && typeof m.page === "string" && typeof m.x === "number" && typeof m.y === "number") {
    return { type: "cursor", page: m.page, x: m.x, y: m.y };
  }
  if (m.type === "op" && typeof m.opId === "string" && typeof m.baseSeq === "number") return { type: "op", opId: m.opId, baseSeq: m.baseSeq, op: m.op };
  return null;
}

async function handle(client: Client, raw: string): Promise<void> {
  const message = parseMessage(raw);
  if (!message) return;
  if (message.type === "cursor") {
    for (const other of onDiagram(client.diagramId)) {
      if (other.user.id !== client.user.id) sendTo(other, { type: "cursor", userId: client.user.id, name: client.user.name, page: message.page, x: message.x, y: message.y });
    }
    return;
  }
  try {
    const { result, replayed } = await runOperation(client.user, client.diagramId, { opId: message.opId, baseSeq: message.baseSeq, op: message.op }, { socket: true, origin: client.id });
    if (replayed) sendTo(client, { type: "ack", ...result, changes: [], routes: {}, author: { id: client.user.id, name: client.user.name }, restored: null });
  } catch (caught) {
    const error = caught instanceof ApiError ? caught : new ApiError("internal");
    if (!(caught instanceof ApiError)) console.error(caught);
    sendTo(client, { type: "refused", opId: message.opId, status: error.status, error: error.body().error });
    if (error.code === "not_found") client.socket.close(CLOSE.notFound);
    if (error.code === "save_unavailable") client.socket.close(CLOSE.outage);
  }
}

async function accept(socket: WebSocket, req: IncomingMessage): Promise<void> {
  const url = new URL(req.url ?? "/", "http://local");
  const diagramId = url.searchParams.get("diagram") ?? "";
  const user = await userForToken(parseCookies(req.headers.cookie).get(SESSION_COOKIE));
  if (!user) return socket.close(CLOSE.session);
  let role: Role;
  let ownerName: string;
  try {
    ({ role, ownerName } = await diagramAccess(user, diagramId));
  } catch {
    return socket.close(CLOSE.notFound);
  }
  if (inOutage(diagramId)) return socket.close(CLOSE.outage);
  const client: Client = { id: nextClient++, socket, user, diagramId, role, lastPong: Date.now(), ready: false, backlog: [], work: Promise.resolve() };
  const firstTab = !onDiagram(diagramId).some((c) => c.user.id === user.id);
  clients.set(client.id, client);
  socket.on("pong", () => {
    client.lastPong = Date.now();
  });
  socket.on("close", () => leave(client));
  socket.on("message", (data) => {
    client.work = client.work.then(() => handle(client, data.toString()));
  });
  const { rows } = await pool.query<{ doc: DiagramDocument; seq: number }>("SELECT doc, seq FROM diagrams WHERE id = $1", [diagramId]);
  const row = rows[0];
  if (!row) return socket.close(CLOSE.notFound);
  const document = { ...row.doc, seq: row.seq };
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ type: "hello", document, role, ownerName, presence: presence(diagramId) } satisfies ServerMessage));
  client.ready = true;
  for (const message of client.backlog.splice(0)) {
    if ((message.type === "op" || message.type === "ack") && message.seq <= document.seq) continue;
    sendTo(client, message);
  }
  if (firstTab) for (const other of onDiagram(diagramId)) if (other.user.id !== user.id) sendTo(other, { type: "joined", name: user.name });
  sendPresence(diagramId);
}

export function attachLive(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? "/", "http://local").pathname;
    if (path !== "/ws" || !sameOrigin(req.headers)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void accept(ws, req);
    });
  });
  const interval = Math.max(250, Math.min(5000, Math.floor(config.presenceTimeoutMs / 4)));
  setInterval(() => {
    const now = Date.now();
    for (const client of [...clients.values()]) {
      if (now - client.lastPong > config.presenceTimeoutMs) {
        client.socket.terminate();
        leave(client);
      } else if (client.socket.readyState === client.socket.OPEN) {
        client.socket.ping();
      }
    }
  }, interval).unref();
}
