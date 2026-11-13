// The project live channel: one WebSocket per page, per-project sequence numbers, replay, presence (DP-05).
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "./config.ts";
import { now } from "./clock.ts";
import { findProject, projectAccess, type UserRow } from "./access.ts";
import { sessionToken, userForToken } from "./auth.ts";
import { db, setBroadcaster, withTx, type LiveEmit, type Queryable, type Tx } from "./db.ts";
import { onDue } from "./deadlines.ts";
import { canSeeIssue } from "./planning/visibility.ts";
import { isRecord } from "./json.ts";

interface Client {
  readonly socket: WebSocket;
  readonly user: UserRow;
  readonly projectId: number;
  viewing: number | null;
  alive: boolean;
  chain: Promise<void>;
}

const REPLAY_LIMIT = 1000;
const clients = new Map<number, Set<Client>>();

interface StoredMessage {
  readonly seq: number;
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly restrict_user: number | null;
  readonly restrict_issue: number | null;
}

async function mayReceive(client: Client, message: { restrictUser: number | null; restrictIssue: number | null }): Promise<boolean> {
  if (message.restrictUser !== null && message.restrictUser !== client.user.id) return false;
  if (message.restrictIssue === null) return true;
  return canSeeIssue(db, client.user.id, message.restrictIssue);
}

function deliver(client: Client, payload: Record<string, unknown>): void {
  if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(payload));
}

function enqueue(client: Client, task: () => Promise<void>): void {
  client.chain = client.chain.then(task).catch(() => undefined);
}

function broadcast(messages: readonly LiveEmit[]): void {
  for (const message of messages) {
    for (const client of clients.get(message.projectId) ?? []) {
      enqueue(client, async () => {
        if (await mayReceive(client, message)) {
          deliver(client, { seq: message.seq, type: message.type, data: message.data });
        }
      });
    }
  }
}

// Sent to every connected page without a sequence number (the instance-wide storage status).
export function broadcastInstance(storageUp: boolean): void {
  for (const set of clients.values()) {
    for (const client of set) deliver(client, { type: "instance", data: { storage: storageUp ? "up" : "down" } });
  }
}

// After a role change or removal the person's sockets learn about it, then lose the channel if they lost read access.
export function revalidateAccess(projectId: number, userId: number): void {
  for (const client of [...(clients.get(projectId) ?? [])]) {
    if (client.user.id !== userId) continue;
    enqueue(client, async () => {
      const project = await findProject(db, projectId);
      const access = project === undefined ? undefined : await projectAccess(db, userId, project);
      if (access === undefined || !access.canRead) client.socket.close(1000, "access revoked");
    });
  }
}

async function replay(client: Client, since: number): Promise<void> {
  const current = await db.one<{ seq: number }>("SELECT seq FROM projects WHERE id = $1", [client.projectId]);
  if (current.seq - since > REPLAY_LIMIT) {
    deliver(client, { type: "resync" });
    return;
  }
  const rows = await db.q<StoredMessage>(
    "SELECT seq, type, data, restrict_user, restrict_issue FROM live_messages WHERE project_id = $1 AND seq > $2 ORDER BY seq",
    [client.projectId, since],
  );
  for (const row of rows) {
    if (await mayReceive(client, { restrictUser: row.restrict_user, restrictIssue: row.restrict_issue })) {
      deliver(client, { seq: row.seq, type: row.type, data: row.data });
    }
  }
}

async function setViewing(client: Client, next: number | null): Promise<void> {
  const previous = client.viewing;
  if (previous === next) return;
  client.viewing = next;
  await withTx(async (tx) => {
    await tx.lockProject(client.projectId);
    if (previous !== null) await leave(tx, client.projectId, previous, client.user.id);
    if (next !== null) {
      await tx.q(
        `INSERT INTO presence (project_id, mr_iid, user_id, connections, expires_at) VALUES ($1, $2, $3, 1, NULL)
         ON CONFLICT (project_id, mr_iid, user_id) DO UPDATE SET connections = presence.connections + 1, expires_at = NULL`,
        [client.projectId, next, client.user.id],
      );
      await tx.emit(client.projectId, "presence", { iid: next, users: await viewersOf(tx, client.projectId, next) });
    }
  });
}

async function leave(tx: Tx, projectId: number, iid: number, userId: number): Promise<void> {
  await tx.q(
    `UPDATE presence SET connections = GREATEST(connections - 1, 0),
            expires_at = CASE WHEN connections <= 1 THEN $4::bigint ELSE NULL END
      WHERE project_id = $1 AND mr_iid = $2 AND user_id = $3`,
    [projectId, iid, userId, now() + config.presenceTimeoutMs],
  );
  await tx.emit(projectId, "presence", { iid, users: await viewersOf(tx, projectId, iid) });
}

// The people with a merge request open: those with a socket now, and those whose socket closed within the timeout.
export async function viewersOf(q: Queryable, projectId: number, iid: number): Promise<string[]> {
  const rows = await q.q<{ username: string }>(
    `SELECT u.username FROM presence p JOIN users u ON u.id = p.user_id
      WHERE p.project_id = $1 AND p.mr_iid = $2 AND (p.connections > 0 OR p.expires_at > $3) ORDER BY u.username`,
    [projectId, iid, now()],
  );
  return rows.map((row) => row.username);
}

async function expirePresence(): Promise<void> {
  const due = await db.q<{ project_id: number; mr_iid: number }>(
    "SELECT DISTINCT project_id, mr_iid FROM presence WHERE connections = 0 AND expires_at IS NOT NULL AND expires_at <= $1",
    [now()],
  );
  for (const row of due) {
    await withTx(async (tx) => {
      await tx.lockProject(row.project_id);
      await tx.q("DELETE FROM presence WHERE project_id = $1 AND mr_iid = $2 AND connections = 0 AND expires_at <= $3", [row.project_id, row.mr_iid, now()]);
      await tx.emit(row.project_id, "presence", { iid: row.mr_iid, users: await viewersOf(tx, row.project_id, row.mr_iid) });
    });
  }
}

function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachLive(server: Server): void {
  const sockets = new WebSocketServer({ noServer: true });
  onDue(expirePresence);

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/live") {
      rejectUpgrade(socket, "404 Not Found");
      return;
    }
    const projectId = Number(url.searchParams.get("project"));
    const since = Number(url.searchParams.get("since") ?? "0");
    void (async () => {
      const user = await userForToken(sessionToken(req));
      const project = user === undefined || !Number.isInteger(projectId) ? undefined : await findProject(db, projectId);
      const access = user === undefined || project === undefined ? undefined : await projectAccess(db, user.id, project);
      if (user === undefined || access === undefined || !access.canRead) {
        rejectUpgrade(socket, "404 Not Found");
        return;
      }
      sockets.handleUpgrade(req, socket, head, (ws) => {
        const client: Client = { socket: ws, user, projectId, viewing: null, alive: true, chain: Promise.resolve() };
        const set = clients.get(projectId) ?? new Set<Client>();
        set.add(client);
        clients.set(projectId, set);
        enqueue(client, () => replay(client, Number.isFinite(since) ? since : 0));
        ws.on("pong", () => {
          client.alive = true;
        });
        ws.on("message", (raw) => {
          const message = parseClientMessage(raw.toString());
          if (message !== undefined) enqueue(client, () => setViewing(client, message.mr));
        });
        ws.on("close", () => {
          set.delete(client);
          if (client.viewing !== null) {
            const iid = client.viewing;
            client.viewing = null;
            void withTx(async (tx) => {
              await tx.lockProject(projectId);
              await leave(tx, projectId, iid, user.id);
            }).catch(() => undefined);
          }
        });
        ws.on("error", () => undefined);
      });
    })().catch(() => rejectUpgrade(socket, "503 Service Unavailable"));
  });

  setBroadcaster(broadcast);
  setInterval(() => {
    for (const set of clients.values()) {
      for (const client of set) {
        if (!client.alive) {
          client.socket.terminate();
          continue;
        }
        client.alive = false;
        client.socket.ping();
      }
    }
  }, 20000);
}

function parseClientMessage(text: string): { mr: number | null } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return undefined;
    const record = value;
    if (record["type"] !== "presence") return undefined;
    const mr = record["mr"];
    return { mr: typeof mr === "number" && Number.isInteger(mr) ? mr : null };
  } catch {
    return undefined;
  }
}
