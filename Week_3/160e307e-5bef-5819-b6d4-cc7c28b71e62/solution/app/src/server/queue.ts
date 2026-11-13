import { config } from "./config";
import { query, transaction } from "./db";
import type { Row } from "./db";
import { ApiError } from "./errors";
import * as hub from "./hub";
import { createActiveMatch, locks } from "./matches";
import { toPlayer } from "./players";
import type { Player } from "./players";

/** The casual and ranked queues. Pairing is one atomic claim; a ranked band starts at 100 and widens by 50 each period. */

export type QueueMode = "casual" | "ranked";

const BAND_START = 100;
const BAND_STEP = 50;
const BAND_LIMIT = 400;
const ENTRY_LIFETIME_MS = 15 * 60 * 1000;

interface Entry {
  playerId: string;
  mode: QueueMode;
  near: number;
  joinedAt: Date;
  matchId: string | null;
}

function toEntry(row: Row): Entry {
  return {
    playerId: row.player_id as string,
    mode: row.mode as QueueMode,
    near: row.near as number,
    joinedAt: row.joined_at as Date,
    matchId: (row.match_id as string | null) ?? null,
  };
}

function waitedSeconds(entry: Entry, now: number): number {
  return Math.max(0, Math.floor((now - entry.joinedAt.getTime()) / 1000));
}

function halfWidth(entry: Entry, now: number): number {
  const periods = Math.floor((now - entry.joinedAt.getTime()) / 1000 / config.bandWidenSeconds);
  return Math.min(BAND_LIMIT, BAND_START + BAND_STEP * Math.max(0, periods));
}

function bandOf(entry: Entry, now: number): { low: number; high: number } | null {
  if (entry.mode !== "ranked") return null;
  const width = halfWidth(entry, now);
  return { low: entry.near - width, high: entry.near + width };
}

function statusOf(entry: Entry, now: number): Record<string, unknown> {
  return {
    mode: entry.mode,
    near: entry.near,
    band: bandOf(entry, now),
    waitedSeconds: waitedSeconds(entry, now),
    matchId: entry.matchId,
  };
}

export async function enterQueue(player: Player, mode: QueueMode): Promise<Record<string, unknown>> {
  if (mode === "ranked" && player.email === null) throw new ApiError(403, "LINK_REQUIRED");
  const entry: Entry = { playerId: player.id, mode, near: Math.round(player.rating), joinedAt: new Date(), matchId: null };
  await query(
    `INSERT INTO queue_entries (player_id, mode, near, joined_at, match_id) VALUES ($1, $2, $3, $4, NULL)
     ON CONFLICT (player_id) DO UPDATE SET mode = $2, near = $3, joined_at = $4, match_id = NULL`,
    [entry.playerId, mode, entry.near, entry.joinedAt],
  );
  lastBand.delete(player.id);
  await pairQueue();
  return { mode, near: entry.near, band: bandOf(entry, Date.now()) };
}

export async function queueStatus(playerId: string): Promise<Record<string, unknown> | null> {
  const found = await query("SELECT * FROM queue_entries WHERE player_id = $1", [playerId]);
  return found[0] ? statusOf(toEntry(found[0]), Date.now()) : null;
}

export async function leaveQueue(playerId: string): Promise<void> {
  await query("DELETE FROM queue_entries WHERE player_id = $1", [playerId]);
  lastBand.delete(playerId);
}

function compatible(a: Entry, b: Entry, now: number): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "casual") return true;
  return Math.abs(a.near - b.near) <= Math.min(halfWidth(a, now), halfWidth(b, now));
}

/** Pairs waiting entries, the longest-waiting first; the earlier joiner takes seat 0. */
function pairQueue(): Promise<void> {
  return locks.run("queue", async () => {
    const pairs = await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(7340212)");
      const now = Date.now();
      await db.query("DELETE FROM queue_entries WHERE joined_at < $1", [new Date(now - ENTRY_LIFETIME_MS)]);
      const waiting = (await db.query("SELECT * FROM queue_entries WHERE match_id IS NULL ORDER BY joined_at, player_id")).rows.map(toEntry);
      const claimed = new Set<string>();
      const made: { matchId: string; players: [string, string] }[] = [];
      for (const first of waiting) {
        if (claimed.has(first.playerId)) continue;
        const partner = waiting.find((other) => other.playerId !== first.playerId && !claimed.has(other.playerId) && compatible(first, other, now));
        if (!partner) continue;
        claimed.add(first.playerId);
        claimed.add(partner.playerId);
        const seated = (await db.query("SELECT * FROM players WHERE id = ANY($1)", [[first.playerId, partner.playerId]])).rows.map(toPlayer);
        const seat0 = seated.find((p) => p.id === first.playerId) as Player;
        const seat1 = seated.find((p) => p.id === partner.playerId) as Player;
        const matchId = await createActiveMatch(db, first.mode, "quick", [seat0, seat1]);
        await db.query("UPDATE queue_entries SET match_id = $1 WHERE player_id = ANY($2)", [matchId, [seat0.id, seat1.id]]);
        made.push({ matchId, players: [seat0.id, seat1.id] });
        lastBand.delete(seat0.id);
        lastBand.delete(seat1.id);
      }
      return made;
    });
    for (const pair of pairs) {
      for (const playerId of pair.players) {
        hub.toPlayer(playerId, { type: "matchFound", matchId: pair.matchId });
      }
    }
  });
}

const lastBand = new Map<string, string>();

/** Pushes a changed band to waiting players, then pairs. Runs on the server tick. */
export async function tickQueue(): Promise<void> {
  const waiting = (await query("SELECT * FROM queue_entries WHERE match_id IS NULL")).map(toEntry);
  const now = Date.now();
  for (const entry of waiting) {
    const key = JSON.stringify(bandOf(entry, now));
    if (lastBand.get(entry.playerId) !== key) {
      lastBand.set(entry.playerId, key);
      hub.toPlayer(entry.playerId, { type: "queueStatus", ...statusOf(entry, now) });
    }
  }
  if (waiting.length > 1) await pairQueue();
}
