import type { ServerResponse } from "node:http";
import { pool } from "./db";
import { LockStoreError } from "./errors";
import { getStatus } from "./services/status";
import { valkey, type LockEntry, type PresenceEntry } from "./services/valkey";
import type { Role } from "./access";

const TICK_MS = 500;
const KEEPALIVE_MS = 10000;

export interface Connection {
  res: ServerResponse;
  userId: string;
  displayName: string;
  tab: string;
  workspaceId: string;
  role: Role;
  lastWrite: number;
}

interface PresenceBody {
  people: Array<{ userId: string; displayName: string; cursor: [number, number, number] | null; selected: string | null; role: Role }>;
  locks: Array<{ objectId: string; holder: { userId: string; displayName: string }; fence: number; expiresAt: string }>;
}

export function writeEvent(connection: Connection, event: string, data: unknown): void {
  if (connection.res.writableEnded || connection.res.destroyed) return;
  connection.lastWrite = Date.now();
  connection.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** The presence body of GET /api/scenes/<sid>/presence: people (one per person), roles included, and the live leases. */
export async function presenceBody(sceneId: string, workspaceId: string): Promise<PresenceBody> {
  const [entries, locks] = await Promise.all([valkey.listPresence(sceneId), valkey.list(sceneId)]);
  const roles = await pool.query<{ user_id: string; role: Role }>("SELECT user_id, role FROM memberships WHERE workspace_id = $1 AND user_id = ANY($2)", [workspaceId, [...new Set(entries.map((e) => e.userId))]]);
  const roleOf = new Map(roles.rows.map((r) => [r.user_id, r.role]));
  const grouped = new Map<string, PresenceEntry[]>();
  for (const entry of entries) grouped.set(entry.userId, [...(grouped.get(entry.userId) ?? []), entry]);
  const people = [...grouped.entries()]
    .map(([userId, tabs]) => ({
      userId,
      displayName: tabs[0].displayName,
      cursor: tabs.find((t) => t.cursor !== null)?.cursor ?? null,
      selected: tabs.find((t) => t.selected !== null)?.selected ?? null,
      role: roleOf.get(userId) ?? ("viewer" as Role),
    }))
    .sort((a, b) => (a.displayName === b.displayName ? (a.userId < b.userId ? -1 : 1) : a.displayName < b.displayName ? -1 : 1));
  return { people, locks: locks.map(lockJson) };
}

export const lockJson = (lock: LockEntry): PresenceBody["locks"][number] => ({ objectId: lock.objectId, holder: { userId: lock.userId, displayName: lock.displayName }, fence: lock.fence, expiresAt: lock.expiresAt });

const diffKey = (body: PresenceBody): string => JSON.stringify({ people: body.people, locks: body.locks.map((l) => [l.objectId, l.holder, l.fence]) });

class SceneHub {
  readonly connections = new Set<Connection>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  private revision: { revision: number; stateHash: string } | null = null;
  private presence: { key: string; body: PresenceBody } | null = null;
  private status: string | null = null;
  private workspaceId = "";

  constructor(readonly sceneId: string) {}

  add(connection: Connection): void {
    this.workspaceId = connection.workspaceId;
    this.connections.add(connection);
    if (this.revision) writeEvent(connection, "revision", this.revision);
    if (this.presence) writeEvent(connection, "presence", this.presence.body);
    if (this.status) connection.res.write(`event: status\ndata: ${this.status}\n\n`);
    this.timer ??= setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  remove(connection: Connection): boolean {
    this.connections.delete(connection);
    if (this.connections.size > 0) return false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return true;
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      await this.step();
    } catch {
      /* a failed tick is retried by the next one */
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        void this.tick();
      }
    }
  }

  private broadcast(event: string, data: unknown): void {
    for (const connection of this.connections) writeEvent(connection, event, data);
  }

  private async step(): Promise<void> {
    if (this.connections.size === 0) return;
    const scene = await pool.query<{ revision: number; state_hash: string }>("SELECT revision, state_hash FROM scenes WHERE id = $1", [this.sceneId]);
    const row = scene.rows[0];
    if (!row) {
      for (const connection of this.connections) connection.res.end();
      return;
    }
    if (this.revision?.revision !== row.revision) {
      this.revision = { revision: row.revision, stateHash: row.state_hash };
      this.broadcast("revision", this.revision);
    }
    const status = JSON.stringify(getStatus());
    if (status !== this.status) {
      this.status = status;
      for (const connection of this.connections) connection.res.write(`event: status\ndata: ${status}\n\n`);
    }
    const roles = await pool.query<{ user_id: string; role: Role }>("SELECT user_id, role FROM memberships WHERE workspace_id = $1 AND user_id = ANY($2)", [
      this.workspaceId,
      [...new Set([...this.connections].map((c) => c.userId))],
    ]);
    const roleOf = new Map(roles.rows.map((r) => [r.user_id, r.role]));
    for (const connection of this.connections) {
      const role = roleOf.get(connection.userId);
      if (!role) connection.res.end();
      else if (role !== connection.role) {
        connection.role = role;
        writeEvent(connection, "role", { role });
      }
    }
    try {
      for (const connection of this.connections) {
        const value = await valkey.touchPresence(this.sceneId, connection.userId, connection.tab, connection.displayName);
        if (value.selected) await valkey.extendLock(this.sceneId, value.selected, connection.userId, connection.tab);
      }
      const body = await presenceBody(this.sceneId, this.workspaceId);
      const key = diffKey(body);
      if (key !== this.presence?.key) {
        this.presence = { key, body };
        this.broadcast("presence", body);
      }
    } catch (error) {
      if (!(error instanceof LockStoreError)) throw error;
      this.presence = null;
    }
    const now = Date.now();
    for (const connection of this.connections) {
      if (now - connection.lastWrite >= KEEPALIVE_MS && !connection.res.writableEnded) {
        connection.lastWrite = now;
        connection.res.write(": keep-alive\n\n");
      }
    }
  }
}

const hubs = new Map<string, SceneHub>();

export function notifyScene(sceneId: string): void {
  void hubs.get(sceneId)?.tick();
}

/** Registers one open editor tab; returns the cleanup that runs when its live channel ends. */
export function attach(sceneId: string, connection: Connection): () => Promise<void> {
  let hub = hubs.get(sceneId);
  if (!hub) {
    hub = new SceneHub(sceneId);
    hubs.set(sceneId, hub);
  }
  hub.add(connection);
  return async () => {
    const owned = hubs.get(sceneId);
    if (!owned) return;
    if (owned.remove(connection)) hubs.delete(sceneId);
    const sameTab = [...owned.connections].some((c) => c.userId === connection.userId && c.tab === connection.tab);
    if (sameTab) return;
    try {
      await valkey.deletePresence(sceneId, connection.userId, connection.tab);
      await valkey.releaseWhere(sceneId, (lock) => lock.userId === connection.userId && lock.tab === connection.tab);
    } catch {
      /* the lease TTL is the fallback when the lock store is unreachable */
    }
    notifyScene(sceneId);
  };
}
