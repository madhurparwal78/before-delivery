// The scene event stream. Changes are announced through PostgreSQL NOTIFY so every serve instance relays them
// to its own open editors; presence and locks are re-read from PocketBase and sent only when they change.
import type { ServerResponse } from "node:http";
import pg from "pg";
import { config } from "./config.js";
import { pool, rows } from "./db.js";
import type { Op } from "../shared/api-types.js";
import { listLocks, listPresence } from "./domain/locks.js";
import { opRowToOp, type OpRow } from "./domain/history.js";

type Kind = "op" | "lock" | "presence" | "comment" | "version";
interface Notice { scene: string; kind: Kind; data?: unknown; batchId?: string }

const CHANNEL = "orrery_scene_events";
const watchers = new Map<string, Set<ServerResponse>>();
const lastSent = new Map<string, { locks: string; presence: string }>();

function write(scene: string, event: string, data: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of watchers.get(scene) ?? []) res.write(frame);
}

/** Announces a change to every instance; delivery happens in onNotice. */
export async function announce(scene: string, kind: Kind, extra: { data?: unknown; batchId?: string } = {}): Promise<void> {
  await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify({ scene, kind, ...extra } satisfies Notice)]);
}

/** Re-reads locks and presence for a watched scene and sends whichever changed. */
async function refresh(scene: string, force = false): Promise<void> {
  if (!watchers.has(scene)) return;
  const [locks, presence] = await Promise.all([listLocks(scene), listPresence(scene)]);
  const previous = lastSent.get(scene) ?? { locks: "", presence: "" };
  const lockKey = JSON.stringify(locks.map((l) => [l.nodeId, l.holder.kind, l.holder.id]).sort());
  const presenceKey = JSON.stringify(presence);
  if (force || lockKey !== previous.locks) {
    const byNode = new Map(locks.map((l) => [l.nodeId, l]));
    const before: [string, string, string][] = previous.locks ? JSON.parse(previous.locks) : [];
    for (const [nodeId] of before) if (!byNode.has(nodeId)) write(scene, "lock", { nodeId, holder: null });
    for (const lock of locks) write(scene, "lock", { nodeId: lock.nodeId, holder: lock.holder });
  }
  if (force || presenceKey !== previous.presence) write(scene, "presence", { authors: presence });
  lastSent.set(scene, { locks: lockKey, presence: presenceKey });
}

async function onNotice(notice: Notice): Promise<void> {
  if (!watchers.has(notice.scene)) return;
  if (notice.kind === "op" && notice.batchId) {
    const ops: Op[] = (await rows<OpRow>(pool, "SELECT * FROM ops WHERE scene_id = $1 AND batch_id = $2 ORDER BY seq", [notice.scene, notice.batchId])).map(opRowToOp);
    write(notice.scene, "op", { batchId: notice.batchId, ops });
  } else if (notice.kind === "lock" || notice.kind === "presence") {
    await refresh(notice.scene);
  } else {
    write(notice.scene, notice.kind, notice.data);
  }
}

export async function listen(): Promise<void> {
  const connectListener = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    client.on("notification", (message) => {
      if (!message.payload) return;
      const notice: Notice = JSON.parse(message.payload);
      onNotice(notice).catch((error: unknown) => console.error("scene event relay failed:", error));
    });
    client.on("error", () => {
      client.end().catch(() => undefined);
      setTimeout(() => { connectListener().catch(() => undefined); }, 1000);
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  };
  await connectListener();
  setInterval(() => {
    for (const scene of watchers.keys()) refresh(scene).catch(() => undefined);
  }, 1000).unref();
}

/** Opens the event stream for one scene and sends the current locks and presence. */
export function watch(scene: string, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(": stream open\n\n");
  const set = watchers.get(scene) ?? new Set<ServerResponse>();
  set.add(res);
  watchers.set(scene, set);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  res.on("close", () => {
    clearInterval(heartbeat);
    set.delete(res);
    if (set.size === 0) { watchers.delete(scene); lastSent.delete(scene); }
  });
  refresh(scene, true).catch(() => undefined);
}
