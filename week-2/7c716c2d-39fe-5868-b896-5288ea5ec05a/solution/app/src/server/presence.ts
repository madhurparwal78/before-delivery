// Presence, room grace and typing. These belong to the person, not to a tab: activity is counted
// per person, the room is left only when the person's last stream has been closed for the grace
// period, and the typing list holds each person once.
import { config } from "./config.js";
import { tx, type Db } from "./db.js";
import { emit } from "./events.js";
import { roomJson, roomLeft } from "./rooms.js";
import { nowMs } from "./time.js";

const TYPING_MS = 5000;
const LEASE_STALE_MS = 15_000;

function activityThrottleMs(): number {
  return Math.min(5000, (config.timers.presenceAway * 1000) / 4);
}

/** Any authenticated request or heartbeat makes the person active. */
export async function markActive(personId: string, workspaceId: string): Promise<void> {
  const now = nowMs();
  await tx(async (db) => {
    const { rows } = await db.query<{ was: string }>(
      `WITH old AS (SELECT presence FROM people WHERE id = $1 FOR UPDATE)
       UPDATE people p SET last_active_at = $2, presence = 'active' FROM old
       WHERE p.id = $1 AND (old.presence = 'away' OR p.last_active_at < $3)
       RETURNING old.presence AS was`,
      [personId, now, now - activityThrottleMs()],
    );
    if (rows[0]?.was !== "away") return;
    await emit(db, workspaceId, "presence", { person_id: personId, status: "active" });
    await emitRoomOf(db, personId, workspaceId);
  });
}

async function emitRoomOf(db: Db, personId: string, workspaceId: string): Promise<void> {
  const { rows } = await db.query<{ room_id: string }>("SELECT room_id FROM room_occupants WHERE person_id = $1", [personId]);
  if (rows[0]) await emit(db, workspaceId, "room", await roomJson(db, rows[0].room_id));
}

export async function typingList(db: Db, channelId: string, now: number = nowMs()): Promise<string[]> {
  const { rows } = await db.query<{ person_id: string }>(
    "SELECT t.person_id FROM typing t JOIN people p ON p.id = t.person_id WHERE t.channel_id = $1 AND t.last_at > $2 ORDER BY lower(p.name), p.id",
    [channelId, now - TYPING_MS],
  );
  return rows.map((r) => r.person_id);
}

/** Records a typing signal; a typing event goes out only when the list changes. */
export async function signalTyping(db: Db, workspaceId: string, channelId: string, personId: string): Promise<void> {
  const now = nowMs();
  await db.query("SELECT 1 FROM channels WHERE id = $1 FOR UPDATE", [channelId]);
  const before = await typingList(db, channelId, now);
  await db.query("INSERT INTO typing (channel_id, person_id, last_at) VALUES ($1, $2, $3) ON CONFLICT (channel_id, person_id) DO UPDATE SET last_at = EXCLUDED.last_at", [channelId, personId, now]);
  if (!before.includes(personId)) await emit(db, workspaceId, "typing", { channel_id: channelId, typing: await typingList(db, channelId, now) }, { channelId });
}

/** A sent message ends its author's typing entry. */
export async function stopTyping(db: Db, workspaceId: string, channelId: string, personId: string): Promise<void> {
  const before = await typingList(db, channelId);
  await db.query("DELETE FROM typing WHERE channel_id = $1 AND person_id = $2", [channelId, personId]);
  if (before.includes(personId)) await emit(db, workspaceId, "typing", { channel_id: channelId, typing: await typingList(db, channelId) }, { channelId });
}

async function lapseTyping(now: number): Promise<void> {
  await tx(async (db) => {
    const { rows } = await db.query<{ channel_id: string; workspace_id: string }>(
      "DELETE FROM typing t USING channels c WHERE c.id = t.channel_id AND t.last_at <= $1 RETURNING t.channel_id, c.workspace_id",
      [now - TYPING_MS],
    );
    const channels = new Map(rows.map((r) => [r.channel_id, r.workspace_id]));
    for (const [channelId, workspaceId] of channels) {
      await emit(db, workspaceId, "typing", { channel_id: channelId, typing: await typingList(db, channelId, now) }, { channelId });
    }
  });
}

async function markAway(now: number): Promise<void> {
  await tx(async (db) => {
    const { rows } = await db.query<{ id: string; workspace_id: string }>(
      `UPDATE people SET presence = 'away'
       WHERE presence = 'active' AND last_active_at <= $1 AND id IN (SELECT person_id FROM room_occupants)
       RETURNING id, workspace_id`,
      [now - config.timers.presenceAway * 1000],
    );
    for (const row of rows) {
      await emit(db, row.workspace_id, "presence", { person_id: row.id, status: "away" });
      await emitRoomOf(db, row.id, row.workspace_id);
    }
  });
}

/** Ages out leases of streams whose process died, then empties rooms once the grace has passed. */
async function leaveAfterGrace(now: number): Promise<void> {
  await tx(async (db) => {
    const { rows: stale } = await db.query<{ person_id: string }>("DELETE FROM stream_leases WHERE seen_at < $1 RETURNING person_id", [now - LEASE_STALE_MS]);
    for (const { person_id } of stale) {
      await db.query(
        "UPDATE people SET streams_closed_at = $2 WHERE id = $1 AND streams_closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM stream_leases WHERE person_id = $1)",
        [person_id, now],
      );
    }
    const { rows } = await db.query<{ person_id: string; room_id: string; workspace_id: string }>(
      `DELETE FROM room_occupants o USING people p
       WHERE p.id = o.person_id AND p.streams_closed_at IS NOT NULL AND p.streams_closed_at <= $1
         AND NOT EXISTS (SELECT 1 FROM stream_leases l WHERE l.person_id = o.person_id)
       RETURNING o.person_id, o.room_id, p.workspace_id`,
      [now - config.timers.streamGrace * 1000],
    );
    for (const row of rows) await roomLeft(db, row.workspace_id, row.room_id);
  });
}

export async function presenceSweep(): Promise<void> {
  const now = nowMs();
  await lapseTyping(now);
  await markAway(now);
  await leaveAfterGrace(now);
}

