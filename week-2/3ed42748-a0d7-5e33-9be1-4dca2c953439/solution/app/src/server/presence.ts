// Presence: heartbeat sequence handling per stream, the 4-second emote window, the listing of
// online couriers (one entry each, public fields only), the staff view and Online now.
// Rows older than 60 seconds are removed; sign-out and redeem act on a session's rows directly.
import type pg from "pg";
import { all, one, type Db } from "./db";
import { ApiError } from "./errors";

const ONLINE_MS = 15_000;
const EMOTE_MS = 4_000;
const STREAM_KEEP_MS = 60_000;
export const EMOTES = ["wave", "cheer", "sleepy", "heart"] as const;
export type Emote = (typeof EMOTES)[number];

export interface Beat {
  stream: string;
  seq: number;
  position: { lat: number; lon: number; heading_deg: number };
  emote: Emote | null;
}

/** The emote others see: only inside its window and never while muted. */
const visibleEmote = (c: { emote: string | null; emote_at: Date | null; muted: boolean }, now: number): string | null =>
  !c.muted && c.emote && c.emote_at && now - c.emote_at.getTime() < EMOTE_MS ? c.emote : null;

export async function heartbeat(db: pg.PoolClient, sessionId: string, courierId: string, beat: Beat): Promise<object> {
  const live = await one(db, "SELECT 1 FROM sessions WHERE id = $1 AND ended_at IS NULL FOR SHARE", [sessionId]);
  if (!live) throw new ApiError(401, "unauthenticated");
  const now = new Date();
  const stored = await one<{ last_seq: number }>(
    db,
    `INSERT INTO presence_streams (session_id, stream, last_seq, lat, lon, heading_deg, received_at, recv_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, nextval('presence_order'))
     ON CONFLICT (session_id, stream) DO UPDATE
       SET last_seq = EXCLUDED.last_seq, lat = EXCLUDED.lat, lon = EXCLUDED.lon, heading_deg = EXCLUDED.heading_deg,
           received_at = EXCLUDED.received_at, recv_order = EXCLUDED.recv_order
     WHERE presence_streams.last_seq < EXCLUDED.last_seq
     RETURNING last_seq`,
    [sessionId, beat.stream, beat.seq, beat.position.lat, beat.position.lon, beat.position.heading_deg, now],
  );
  const accepted = stored !== undefined;
  if (accepted && beat.emote)
    await db.query("UPDATE couriers SET emote = $2, emote_at = $3 WHERE id = $1 AND NOT muted", [
      courierId,
      beat.emote,
      now,
    ]);
  const lastSeq =
    stored?.last_seq ??
    (await one<{ last_seq: number }>(db, "SELECT last_seq FROM presence_streams WHERE session_id = $1 AND stream = $2", [
      sessionId,
      beat.stream,
    ]))!.last_seq;
  const c = (await one<{ emote: string | null; emote_at: Date | null; muted: boolean }>(
    db,
    "SELECT emote, emote_at, muted FROM couriers WHERE id = $1",
    [courierId],
  ))!;
  return { accepted, last_seq: lastSeq, emote: visibleEmote(c, now.getTime()), muted: c.muted };
}

interface OnlineRow {
  courier_id: string;
  role: string;
  display_name: string;
  satchel_id: string;
  moderation_ref: string;
  muted: boolean;
  name_locked: boolean;
  emote: string | null;
  emote_at: Date | null;
  lat: number;
  lon: number;
  heading_deg: number;
}

/** Every online courier once, at their newest accepted heartbeat from any live session. */
async function online(db: Db): Promise<OnlineRow[]> {
  const now = Date.now();
  return all<OnlineRow>(
    db,
    `SELECT c.id AS courier_id, c.role, c.display_name, c.satchel_id, c.moderation_ref, c.muted, c.name_locked,
            c.emote, c.emote_at, latest.lat, latest.lon, latest.heading_deg
       FROM (SELECT DISTINCT ON (s.courier_id) s.courier_id, ps.lat, ps.lon, ps.heading_deg
               FROM presence_streams ps JOIN sessions s ON s.id = ps.session_id
              WHERE s.ended_at IS NULL AND ps.received_at >= $1
              ORDER BY s.courier_id, ps.recv_order DESC) latest
       JOIN couriers c ON c.id = latest.courier_id
      ORDER BY c.display_name COLLATE "C", c.moderation_ref`,
    [new Date(now - ONLINE_MS)],
  ).then((rows) => rows.map((r) => ({ ...r, emote: visibleEmote(r, now) })));
}

const publicEntry = (r: OnlineRow) => ({
  display_name: r.display_name,
  satchel_colour: r.satchel_id,
  position: { lat: r.lat, lon: r.lon, heading_deg: r.heading_deg },
  emote: r.emote,
});

export async function presenceFor(db: Db, courierId: string): Promise<object> {
  const rows = await online(db);
  return { couriers: rows.filter((r) => r.courier_id !== courierId).map(publicEntry) };
}

export async function staffPresenceFor(db: Db, courierId: string): Promise<object> {
  const rows = await online(db);
  return {
    couriers: rows
      .filter((r) => r.courier_id !== courierId)
      .map((r) => ({
        moderation_ref: r.moderation_ref,
        ...publicEntry(r),
        muted: r.muted,
        name_locked: r.name_locked,
      })),
  };
}

export async function onlineNow(db: Db): Promise<object> {
  const rows = await online(db);
  const guests = rows.filter((r) => r.role === "guest").length;
  return { online: rows.length, guests, signed_in: rows.length - guests };
}

/** Sign-out and redeem: the ended session's heartbeats leave at once, in the caller's transaction. */
export async function dropSessionPresence(db: pg.PoolClient, sessionId: string): Promise<void> {
  await db.query("DELETE FROM presence_streams WHERE session_id = $1", [sessionId]);
}

export async function moveSessionPresence(db: pg.PoolClient, from: string, to: string): Promise<void> {
  await db.query("UPDATE presence_streams SET session_id = $2 WHERE session_id = $1", [from, to]);
}

export async function pruneStreams(db: Db): Promise<void> {
  await db.query("DELETE FROM presence_streams WHERE received_at < $1", [new Date(Date.now() - STREAM_KEEP_MS)]);
}
