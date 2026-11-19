import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Redis, type RedisOptions } from "ioredis";
import { WebSocketServer, type WebSocket } from "ws";
import type { ChangeMessage, LiveMessage } from "../shared/types.js";
import type { ChangeRecord } from "./commit.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const streamKey = (ownerId: string) => `twig:outline:${ownerId}:changes`;
const revokedChannel = (ownerId: string) => `twig:outline:${ownerId}:revoked`;
const REVOKED_PATTERN = "twig:outline:*:revoked";
const READ_BLOCK_MS = 500;
const PING_TIMEOUT_MS = 1000;
const OUTBOX_RETRY_MS = 1000;

const options: RedisOptions = {
  enableOfflineQueue: false,
  connectTimeout: 2000,
  retryStrategy: (attempt) => Math.min(attempt * 250, 2000),
};

function connect(): Redis {
  const connection = new Redis(config.valkeyUrl, options);
  connection.on("error", () => undefined);
  return connection;
}

const commands = connect();
const reader = connect();
const subscriber = connect();

let healthy = false;

async function ping(): Promise<boolean> {
  try {
    const answer = await Promise.race([
      commands.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), PING_TIMEOUT_MS)),
    ]);
    healthy = answer === "PONG";
  } catch {
    healthy = false;
  }
  return healthy;
}

interface Viewer {
  socket: WebSocket;
  accountId: string;
  ownerId: string;
  /** The shared bullet a collaborator's view hangs from; null for the owner. */
  shareRoot: string | null;
  lastSent: number;
  ready: boolean;
  buffer: ChangeRecord[];
  replayFrom: number | null;
  greeted: boolean;
}

const viewers = new Map<string, Set<Viewer>>();
const cursors = new Map<string, string>();

function messageFor(viewer: Viewer, record: ChangeRecord): ChangeMessage | null {
  if (viewer.shareRoot === null) return { type: "change", seq: record.seq, bullets: record.bullets, removed: record.removed };
  const delta = record.shares[viewer.shareRoot];
  if (delta === undefined) return null;
  const wanted = new Set(delta.bullets);
  const bullets = record.bullets
    .filter((bullet) => wanted.has(bullet.id))
    .map((bullet) => ({
      ...bullet,
      depth: Math.max(0, bullet.depth - delta.depth),
      parentId: bullet.id === viewer.shareRoot ? null : bullet.parentId,
    }));
  return bullets.length === 0 && delta.removed.length === 0
    ? null
    : { type: "change", seq: record.seq, bullets, removed: delta.removed };
}

function send(viewer: Viewer, message: LiveMessage): void {
  if (viewer.socket.readyState === viewer.socket.OPEN) viewer.socket.send(JSON.stringify(message));
}

function emit(viewer: Viewer, record: ChangeRecord): void {
  if (record.seq <= viewer.lastSent) return;
  viewer.lastSent = record.seq;
  const message = messageFor(viewer, record);
  if (message !== null) send(viewer, message);
}

function deliver(viewer: Viewer, record: ChangeRecord): void {
  if (viewer.ready) emit(viewer, record);
  else viewer.buffer.push(record);
}

function revoke(viewer: Viewer): void {
  send(viewer, { type: "revoked" });
  viewer.socket.close(1000, "revoked");
}

async function topOfStream(ownerId: string): Promise<string> {
  const last = await commands.xrevrange(streamKey(ownerId), "+", "-", "COUNT", 1);
  return last[0]?.[0] ?? "0-0";
}

async function ensureCursor(ownerId: string): Promise<void> {
  if (!cursors.has(ownerId)) cursors.set(ownerId, await topOfStream(ownerId));
}

async function replay(viewer: Viewer, since: number): Promise<"done" | "reload"> {
  const current = await pool.query<{ seq: number }>("SELECT seq FROM outline_seqs WHERE owner_id = $1", [viewer.ownerId]);
  const latest = current.rows[0]?.seq ?? 0;
  if (since > latest || latest - since > config.streamMaxLength) return "reload";
  const records = new Map<number, ChangeRecord>();
  if (latest > since) {
    const entries = await commands.xrange(streamKey(viewer.ownerId), `${since + 1}-0`, "+");
    for (const [, fields] of entries) {
      const at = fields.indexOf("change");
      const raw = at >= 0 ? fields[at + 1] : undefined;
      if (raw !== undefined) {
        const record = JSON.parse(raw) as ChangeRecord;
        records.set(record.seq, record);
      }
    }
    const pending = await pool.query<{ payload: ChangeRecord }>(
      "SELECT payload FROM changes WHERE owner_id = $1 AND seq > $2 AND NOT published ORDER BY seq",
      [viewer.ownerId, since],
    );
    for (const row of pending.rows) records.set(row.payload.seq, row.payload);
  }
  for (let seq = since + 1; seq <= latest; seq += 1) {
    if (!records.has(seq)) return "reload";
  }
  for (let seq = since + 1; seq <= latest; seq += 1) {
    const record = records.get(seq);
    if (record !== undefined) emit(viewer, record);
  }
  return "done";
}

async function catchUp(viewer: Viewer, since: number): Promise<void> {
  let outcome: "done" | "reload";
  try {
    await ensureCursor(viewer.ownerId);
    outcome = await replay(viewer, since);
  } catch {
    viewer.replayFrom = since;
    return;
  }
  viewer.replayFrom = null;
  if (outcome === "reload") {
    send(viewer, { type: "reload" });
    viewer.socket.close(1000, "reload");
    return;
  }
  viewer.ready = true;
  for (const record of viewer.buffer.splice(0)) emit(viewer, record);
}

function dispatch(ownerId: string, record: ChangeRecord): void {
  for (const viewer of viewers.get(ownerId) ?? []) deliver(viewer, record);
}

async function readLoop(): Promise<void> {
  for (;;) {
    const owners = [...viewers.keys()].filter((ownerId) => cursors.has(ownerId));
    if (owners.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    try {
      const answer = await reader.xread(
        "BLOCK", READ_BLOCK_MS, "STREAMS",
        ...owners.map(streamKey), ...owners.map((ownerId) => cursors.get(ownerId) ?? "0-0"),
      );
      for (const [key, entries] of answer ?? []) {
        const ownerId = owners.find((candidate) => streamKey(candidate) === key);
        if (ownerId === undefined) continue;
        for (const [id, fields] of entries) {
          cursors.set(ownerId, id);
          const at = fields.indexOf("change");
          const raw = at >= 0 ? fields[at + 1] : undefined;
          if (raw !== undefined) dispatch(ownerId, JSON.parse(raw) as ChangeRecord);
        }
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

export async function publishPending(ownerId: string): Promise<void> {
  const client = await pool.connect();
  const lock = "SELECT pg_try_advisory_lock(hashtextextended($1, 1)) AS held";
  try {
    const held = await client.query<{ held: boolean }>(lock, [`publish:${ownerId}`]);
    if (held.rows[0]?.held !== true) return;
    try {
      for (;;) {
        const rows = await client.query<{ seq: number; payload: ChangeRecord }>(
          "SELECT seq, payload FROM changes WHERE owner_id = $1 AND NOT published ORDER BY seq LIMIT 100",
          [ownerId],
        );
        if (rows.rows.length === 0) return;
        for (const row of rows.rows) {
          try {
            await commands.xadd(
              streamKey(ownerId), "MAXLEN", config.streamMaxLength, `${row.seq}-0`,
              "seq", String(row.seq), "change", JSON.stringify(row.payload),
            );
          } catch (error) {
            if (!(error instanceof Error) || !error.message.includes("equal or smaller")) {
              healthy = false;
              return;
            }
          }
          healthy = true;
          await client.query("UPDATE changes SET published = true WHERE owner_id = $1 AND seq = $2", [ownerId, row.seq]);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 1))", [`publish:${ownerId}`]);
    }
  } finally {
    client.release();
  }
}

export async function announceRevocation(ownerId: string, shareRoot: string): Promise<void> {
  for (const viewer of viewers.get(ownerId) ?? []) if (viewer.shareRoot === shareRoot) revoke(viewer);
  await commands.publish(revokedChannel(ownerId), JSON.stringify({ shareRoot })).catch(() => 0);
}

async function stillShared(viewer: Viewer): Promise<boolean> {
  if (viewer.shareRoot === null) return true;
  const found = await pool.query(
    "SELECT 1 FROM shares WHERE owner_id = $1 AND bullet_id = $2 AND account_id = $3 AND status = 'accepted'",
    [viewer.ownerId, viewer.shareRoot, viewer.accountId],
  );
  return (found.rowCount ?? 0) > 0;
}

function heartbeat(viewer: Viewer): void {
  const first = !viewer.greeted;
  viewer.greeted = true;
  send(viewer, {
    type: "heartbeat",
    fanout: healthy ? "ok" : "paused",
    ...(first ? { heartbeatSeconds: config.heartbeatSeconds, pauseAfterSeconds: config.pauseAfterSeconds } : {}),
  });
}

async function tick(): Promise<void> {
  await ping();
  for (const set of viewers.values()) {
    for (const viewer of set) {
      if (!(await stillShared(viewer))) {
        revoke(viewer);
        continue;
      }
      if (viewer.replayFrom !== null && healthy) await catchUp(viewer, viewer.replayFrom);
      heartbeat(viewer);
    }
  }
}

async function retryOutbox(): Promise<void> {
  const owners = await pool.query<{ owner_id: string }>("SELECT DISTINCT owner_id FROM changes WHERE NOT published LIMIT 50");
  for (const row of owners.rows) await publishPending(row.owner_id);
}

export function startLive(): void {
  subscriber.on("ready", () => void subscriber.psubscribe(REVOKED_PATTERN).catch(() => 0));
  subscriber.on("pmessage", (_pattern, channel, message) => {
    const ownerId = channel.split(":")[2] ?? "";
    const { shareRoot } = JSON.parse(message) as { shareRoot: string };
    for (const viewer of viewers.get(ownerId) ?? []) if (viewer.shareRoot === shareRoot) revoke(viewer);
  });
  void ping();
  void readLoop();
  setInterval(() => void tick().catch(() => undefined), config.heartbeatSeconds * 1000);
  setInterval(() => void retryOutbox().catch(() => undefined), OUTBOX_RETRY_MS);
}

const sockets = new WebSocketServer({ noServer: true });

export function accept(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  target: { accountId: string; ownerId: string; shareRoot: string | null; since: number },
): void {
  sockets.handleUpgrade(request, socket, head, (ws) => {
    ws.on("error", () => undefined);
    const viewer: Viewer = {
      socket: ws, accountId: target.accountId, ownerId: target.ownerId, shareRoot: target.shareRoot,
      lastSent: target.since, ready: false, buffer: [], replayFrom: null, greeted: false,
    };
    const set = viewers.get(viewer.ownerId) ?? new Set<Viewer>();
    set.add(viewer);
    viewers.set(viewer.ownerId, set);
    ws.on("close", () => {
      set.delete(viewer);
      if (set.size === 0) {
        viewers.delete(viewer.ownerId);
        cursors.delete(viewer.ownerId);
      }
    });
    void ping().then(() => {
      heartbeat(viewer);
      return catchUp(viewer, target.since);
    });
  });
}
