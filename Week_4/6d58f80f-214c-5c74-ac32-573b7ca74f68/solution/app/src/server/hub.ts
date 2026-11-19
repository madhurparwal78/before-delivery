// GET /api/events: one WebSocket per open screen. Each committed change reaches every session allowed to see it,
// shaped for that session, so an event never names an item, person or folder it cannot see (brief: Timeliness).
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import pg from "pg";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "./config.js";
import { first, pool, rows } from "./db.js";
import { foreignOrigin, sessionOf } from "./http.js";
import { CHANNEL, type Change } from "./changes.js";
import { Viewer, type FileRow } from "./access.js";
import { status } from "./services.js";
import type { EventMessage, Person } from "../shared/api.js";

interface Conn {
  ws: WebSocket;
  sessionHash: string;
  person: Person;
}

const conns = new Set<Conn>();
const wss = new WebSocketServer({ noServer: true });

function send(conn: Conn, message: EventMessage): void {
  if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(message));
}

export function broadcastLocal(message: EventMessage): void {
  for (const conn of conns) send(conn, message);
}

function refuse(socket: Duplex, code: number, text: string): void {
  socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function attach(server: Server): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? "/", "http://app").pathname;
    if (path !== "/api/events") return refuse(socket, 404, "Not Found");
    if (foreignOrigin(req)) return refuse(socket, 403, "Forbidden");
    sessionOf(req).then((session) => {
      if (!session) return refuse(socket, 401, "Unauthorized");
      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn: Conn = { ws, sessionHash: session.tokenHash, person: session.person };
        conns.add(conn);
        ws.on("close", () => conns.delete(conn));
        ws.on("error", () => conns.delete(conn));
        send(conn, { type: "status", data: { ...status } });
      });
    }, () => refuse(socket, 503, "Service Unavailable"));
  });
  setInterval(() => {
    for (const conn of conns) if (conn.ws.readyState === conn.ws.OPEN) conn.ws.ping();
  }, 25_000).unref();
}

async function shape(change: Change, conn: Conn, viewerOf: (p: Person) => Promise<Viewer>, files: Map<string, FileRow>): Promise<EventMessage | null> {
  const staff = conn.person.kind === "staff";
  switch (change.kind) {
    case "files": {
      if (staff) return { type: "files", data: { fileIds: change.fileIds, folderIds: change.folderIds, storage: change.storage } };
      const viewer = await viewerOf(conn.person);
      const folderIds = change.folderIds.filter((id) => viewer.canSeeFolder(id));
      const fileIds = change.fileIds.filter((id) => {
        const row = files.get(id);
        return (row && (viewer.fileRole({ ...row, binned_date: null }) !== null)) || (!row && folderIds.length > 0);
      });
      return fileIds.length || folderIds.length ? { type: "files", data: { fileIds, folderIds, storage: false } } : null;
    }
    case "moved": {
      const viewer = staff ? null : await viewerOf(conn.person);
      const toFolder = viewer ? viewer.shownFolder(change.toFolder.id) : change.toFolder;
      const items = change.items.flatMap((item) => {
        if (!viewer) return [item];
        const row = files.get(item.fileId);
        const seen = viewer.canSeeFolder(item.fromFolderId) || (row !== undefined && viewer.fileRole(row) !== null);
        return seen ? [{ fileId: item.fileId, fromFolderId: viewer.shownFolder(item.fromFolderId).id }] : [];
      });
      return items.length ? { type: "moved", data: { by: change.by, toFolder, items } } : null;
    }
    case "folders": {
      if (staff) return { type: "folders", data: { folderIds: change.folderIds } };
      const viewer = await viewerOf(conn.person);
      const folderIds = change.folderIds.filter((id) => viewer.canSeeFolder(id));
      return folderIds.length ? { type: "folders", data: { folderIds } } : null;
    }
    case "grants":
      if (staff) return { type: "grants", data: { itemType: change.itemType, itemId: change.itemId } };
      return conn.person.id === change.personId ? { type: "access", data: { notice: change.notice } } : null;
    case "handovers": {
      if (!staff) return null;
      const involved = conn.person.id === change.fromId || conn.person.id === change.toId || conn.person.staffRole === "controller";
      return involved ? { type: "handovers", data: { notice: conn.person.id === change.fromId ? change.notice : null } } : null;
    }
    case "policies":
      return staff ? { type: "policies", data: {} } : null;
    case "upload":
      return conn.person.id === change.ownerId ? { type: "upload", data: { upload: change.upload, expired: change.expired } } : null;
    case "signout":
      return null;
  }
}

async function deliver(change: Change): Promise<void> {
  if (change.kind === "signout") {
    for (const conn of conns) if (conn.sessionHash === change.sessionHash) conn.ws.close(4001, "signed out");
    return;
  }
  const viewers = new Map<string, Promise<Viewer>>();
  const viewerOf = (person: Person) => {
    let viewer = viewers.get(person.id);
    if (!viewer) viewers.set(person.id, viewer = Viewer.load(pool, person));
    return viewer;
  };
  const ids = change.kind === "files" ? change.fileIds : change.kind === "moved" ? change.items.map((i) => i.fileId) : [];
  const files = new Map((ids.length ? await rows<FileRow>(pool, "SELECT * FROM files WHERE id = ANY($1)", [ids]) : []).map((f) => [f.id, f]));
  for (const conn of [...conns]) {
    const message = await shape(change, conn, viewerOf, files);
    if (message) send(conn, message);
  }
}

/** LISTENs for committed changes from every server process sharing this database; reconnects on loss. */
export function listen(): void {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  let retrying = false;
  const retry = () => {
    if (retrying) return;
    retrying = true;
    client.end().catch(() => undefined);
    setTimeout(listen, 2_000).unref();
  };
  client.on("error", retry);
  client.on("end", retry);
  client.on("notification", (note) => {
    if (note.channel !== CHANNEL || !note.payload) return;
    void first<{ change: Change }>(pool, "SELECT change FROM outbox WHERE id = $1", [note.payload])
      .then((row) => (row ? deliver(row.change) : undefined))
      .catch((error: unknown) => console.error("event delivery failed:", error instanceof Error ? error.message : error));
  });
  client.connect().then(() => client.query(`LISTEN ${CHANNEL}`)).catch(retry);
}
