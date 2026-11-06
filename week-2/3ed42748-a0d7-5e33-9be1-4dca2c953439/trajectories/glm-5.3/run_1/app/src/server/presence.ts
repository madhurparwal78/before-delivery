import type { Tx } from "./db.js";
import type { Emote } from "../shared/seed.js";

// Presence: heartbeat sequence handling, the emote window and the listing, including
// removal on sign-out and redeem. Rows live only 60 seconds after their last heartbeat.

const EMOTE_WINDOW_MS = 4000;
const FRESH_MS = 15_000;

export type HeartbeatInput = {
  sessionId: string;
  courierId: string;
  muted: boolean;
  stream: string;
  seq: number;
  position: { lat: number; lon: number; heading_deg: number };
  emote: Emote | null;
};

export type HeartbeatResult = {
  accepted: boolean;
  lastSeq: number;
  emote: Emote | null;
  muted: boolean;
};

/** Stores a heartbeat unless it is stale for its stream. A stale heartbeat stores nothing. */
export async function heartbeat(tx: Tx, input: HeartbeatInput): Promise<HeartbeatResult> {
  const { rows } = await tx.query<{ last_seq: string }>(
    `SELECT last_seq::text AS last_seq FROM presence WHERE session_id = $1 AND stream = $2 FOR UPDATE`,
    [input.sessionId, input.stream],
  );
  const highest = rows.length ? Number(rows[0].last_seq) : 0;
  if (input.seq <= highest) {
    const state = await currentCourierState(tx, input.courierId);
    return { accepted: false, lastSeq: highest, emote: state.emote, muted: state.muted };
  }

  const now = new Date();
  const emoteToStore = input.muted ? null : input.emote;
  if (rows.length === 0) {
    await tx.query(
      `INSERT INTO presence (session_id, courier_id, stream, last_seq, lat, lon, heading_deg, emote, emote_at, at, recv)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, nextval('presence_recv_seq'))`,
      [input.sessionId, input.courierId, input.stream, input.seq, input.position.lat, input.position.lon,
       input.position.heading_deg, emoteToStore, emoteToStore ? now : null, now],
    );
  } else {
    // A null or missing emote leaves a stored emote in place until its window ends.
    if (emoteToStore) {
      await tx.query(
        `UPDATE presence SET last_seq=$3, lat=$4, lon=$5, heading_deg=$6, emote=$7, emote_at=$8, at=$9, recv=nextval('presence_recv_seq')
         WHERE session_id=$1 AND stream=$2`,
        [input.sessionId, input.stream, input.seq, input.position.lat, input.position.lon, input.position.heading_deg, emoteToStore, now, now],
      );
    } else {
      await tx.query(
        `UPDATE presence SET last_seq=$3, lat=$4, lon=$5, heading_deg=$6, at=$7, recv=nextval('presence_recv_seq')
         WHERE session_id=$1 AND stream=$2`,
        [input.sessionId, input.stream, input.seq, input.position.lat, input.position.lon, input.position.heading_deg, now],
      );
    }
  }
  // An emote replaces any earlier one at courier level.
  if (emoteToStore) {
    await tx.query(
      `UPDATE presence SET emote = NULL, emote_at = NULL WHERE courier_id = $1 AND NOT (session_id = $2 AND stream = $3) AND emote IS NOT NULL`,
      [input.courierId, input.sessionId, input.stream],
    );
  }
  const state = await currentCourierState(tx, input.courierId);
  return { accepted: true, lastSeq: input.seq, emote: state.emote, muted: state.muted };
}

async function currentCourierState(tx: Tx, courierId: string): Promise<{ emote: Emote | null; muted: boolean }> {
  const { rows } = await tx.query<{ emote: string | null; emote_at: Date | null; muted: boolean }>(
    `SELECT emote, emote_at, false AS muted FROM presence WHERE courier_id = $1 AND emote_at IS NOT NULL
     ORDER BY emote_at DESC LIMIT 1`,
    [courierId],
  );
  const { rows: crows } = await tx.query<{ muted: boolean }>(`SELECT muted FROM couriers WHERE id = $1`, [courierId]);
  const muted = crows[0]?.muted ?? false;
  if (muted) return { emote: null, muted: true };
  const row = rows[0];
  if (!row || !row.emote_at || Date.now() - row.emote_at.getTime() >= EMOTE_WINDOW_MS) return { emote: null, muted };
  return { emote: row.emote as Emote, muted };
}

export type PresenceEntry = {
  display_name: string;
  satchel_colour: string;
  position: { lat: number; lon: number; heading_deg: number };
  emote: Emote | null;
};

/** Lists each online courier exactly once, at their most recently accepted heartbeat. */
export async function listPresence(tx: Tx, excludingCourierId: string | null, now = Date.now()): Promise<PresenceEntry[]> {
  const { rows } = await tx.query<{
    display_name: string; satchel_colour: string; muted: boolean;
    lat: number | null; lon: number | null; heading_deg: number | null;
    emote: string | null; emote_at: Date | null; courier_id: string;
  }>(
    `SELECT DISTINCT ON (p.courier_id) c.display_name, c.worn_satchel AS satchel_colour, c.muted,
            p.lat, p.lon, p.heading_deg, p.emote, p.emote_at, p.courier_id
     FROM presence p JOIN couriers c ON c.id = p.courier_id
     WHERE p.at > $1 ${excludingCourierId ? "AND p.courier_id <> $2" : ""}
     ORDER BY p.courier_id, p.recv DESC`,
    excludingCourierId ? [new Date(now - FRESH_MS), excludingCourierId] : [new Date(now - FRESH_MS)],
  );
  return rows.map((r) => ({
    display_name: r.display_name,
    satchel_colour: r.satchel_colour,
    position: { lat: r.lat ?? 0, lon: r.lon ?? 0, heading_deg: r.heading_deg ?? 0 },
    emote: !r.muted && r.emote && r.emote_at && now - r.emote_at.getTime() < EMOTE_WINDOW_MS ? (r.emote as Emote) : null,
  }));
}

export type StaffEntry = PresenceEntry & {
  moderation_ref: string;
  muted: boolean;
  name_locked: boolean;
};

export async function listStaffPresence(tx: Tx, now = Date.now()): Promise<StaffEntry[]> {
  const { rows } = await tx.query<{
    display_name: string; satchel_colour: string; muted: boolean; name_locked: boolean;
    moderation_ref: string; lat: number | null; lon: number | null; heading_deg: number | null;
    emote: string | null; emote_at: Date | null;
  }>(
    `SELECT DISTINCT ON (p.courier_id) c.display_name, c.worn_satchel AS satchel_colour, c.muted, c.name_locked,
            c.moderation_ref, p.lat, p.lon, p.heading_deg, p.emote, p.emote_at
     FROM presence p JOIN couriers c ON c.id = p.courier_id
     WHERE p.at > $1
     ORDER BY p.courier_id, p.recv DESC`,
    [new Date(now - FRESH_MS)],
  );
  return rows.map((r) => ({
    display_name: r.display_name,
    satchel_colour: r.satchel_colour,
    position: { lat: r.lat ?? 0, lon: r.lon ?? 0, heading_deg: r.heading_deg ?? 0 },
    emote: !r.muted && r.emote && r.emote_at && now - r.emote_at.getTime() < EMOTE_WINDOW_MS ? (r.emote as Emote) : null,
    moderation_ref: r.moderation_ref,
    muted: r.muted,
    name_locked: r.name_locked,
  }));
}

/** Online now: distinct couriers, split into guests and signed in, always summing to the total. */
export async function onlineNow(tx: Tx, now = Date.now()): Promise<{ online: number; guests: number; signed_in: number }> {
  const { rows } = await tx.query<{ role: string; n: string }>(
    `SELECT c.role, count(DISTINCT p.courier_id)::text AS n
     FROM presence p JOIN couriers c ON c.id = p.courier_id
     WHERE p.at > $1 GROUP BY c.role`,
    [new Date(now - FRESH_MS)],
  );
  let guests = 0;
  let signed = 0;
  for (const r of rows) {
    if (r.role === "guest") guests += Number(r.n);
    else signed += Number(r.n);
  }
  return { online: guests + signed, guests, signed_in: signed };
}

/** Deletes a session's heartbeats and streams (sign-out, redeem session rotation). */
export async function removeSessionPresence(tx: Tx, sessionId: string): Promise<void> {
  await tx.query(`DELETE FROM presence WHERE session_id = $1`, [sessionId]);
}

/** Moves a session's heartbeats and streams to another session (redeem). */
export async function moveSessionPresence(tx: Tx, fromSessionId: string, toSessionId: string): Promise<void> {
  await tx.query(`UPDATE presence SET session_id = $2 WHERE session_id = $1`, [fromSessionId, toSessionId]);
}

/** A mute clears the courier's stored emote in the mute's own transaction. */
export async function clearCourierEmote(tx: Tx, courierId: string): Promise<void> {
  await tx.query(`UPDATE presence SET emote = NULL, emote_at = NULL WHERE courier_id = $1`, [courierId]);
}

/** Rows past 60 seconds without a heartbeat are removed. */
export async function sweepPresence(tx: Tx, now = Date.now()): Promise<void> {
  await tx.query(`DELETE FROM presence WHERE at < $1`, [new Date(now - 60_000)]);
}
