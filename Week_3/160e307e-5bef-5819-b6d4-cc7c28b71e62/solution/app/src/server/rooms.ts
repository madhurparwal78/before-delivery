import { randomInt } from "node:crypto";
import { otherSeat } from "../shared/constants";
import { newMatchState } from "../shared/rules";
import type { Format, Seat } from "../shared/types";
import { config } from "./config";
import { query, rows, transaction, uniqueViolation } from "./db";
import type { Db, Row } from "./db";
import { ApiError } from "./errors";
import * as hub from "./hub";
import { insertMatch, loadMatch, locks, matchJson, pushState, seatOf } from "./matches";
import type { Player } from "./players";
import { remainingMs } from "./util";

/** Private rooms (one host, one joiner, server-held expiry) and rematches inside them. */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Inserts a room under a fresh code, retrying while a code collides. */
async function insertRoom(
  db: Db,
  room: { format: Format; hostId: string; guestId: string | null; matchId: string; status: "open" | "full" },
): Promise<string> {
  const expires = new Date(Date.now() + config.roomExpirySeconds * 1000);
  for (;;) {
    const code = newCode();
    await db.query("SAVEPOINT room_code");
    try {
      await db.query(
        "INSERT INTO rooms (code, format, host_id, guest_id, match_id, status, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [code, room.format, room.hostId, room.guestId, room.matchId, room.status, expires],
      );
      await db.query("UPDATE matches SET room_code = $2 WHERE id = $1", [room.matchId, code]);
      return code;
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
      await db.query("ROLLBACK TO SAVEPOINT room_code");
    }
  }
}

export async function createRoom(host: Player, format: Format): Promise<{ code: string; url: string; matchId: string }> {
  return transaction(async (db) => {
    const matchId = await insertMatch(db, { mode: "private", format, seats: [host.id, null], status: "waiting", state: newMatchState(format, 0) });
    const code = await insertRoom(db, { format, hostId: host.id, guestId: null, matchId, status: "open" });
    return { code, url: `/join/${code}`, matchId };
  });
}

async function roomRow(code: string, db?: Db, lock = false): Promise<Row | null> {
  const sql = `SELECT r.*, h.name AS host_name, g.name AS guest_name FROM rooms r
    JOIN players h ON h.id = r.host_id LEFT JOIN players g ON g.id = r.guest_id WHERE r.code = $1${lock ? " FOR UPDATE OF r" : ""}`;
  const found = db ? await rows(db, sql, [code]) : await query(sql, [code]);
  return found[0] ?? null;
}

function roomView(row: Row): Record<string, unknown> {
  const open = row.status === "open" && (row.expires_at as Date).getTime() > Date.now();
  const closed = row.status === "closed" || (row.status === "open" && !open);
  return {
    code: row.code,
    format: row.format,
    status: closed ? "closed" : row.guest_id ? "full" : "open",
    host: { id: row.host_id, name: row.host_name },
    guest: row.guest_id ? { id: row.guest_id, name: row.guest_name } : null,
    expiresInMs: open ? remainingMs(row.expires_at) : null,
    matchId: row.match_id,
  };
}

export async function roomJson(code: string): Promise<Record<string, unknown>> {
  const row = await roomRow(code);
  if (!row) throw new ApiError(404, "ROOM_NOT_FOUND");
  return roomView(row);
}

async function pushRoom(code: string): Promise<void> {
  const row = await roomRow(code);
  if (row) hub.toMatch(row.match_id as string, { type: "roomStatus", ...roomView(row) });
}

export async function joinRoom(player: Player, code: string): Promise<{ matchId: string }> {
  const matchId = await transaction(async (db) => {
    const row = await roomRow(code, db, true);
    if (!row) throw new ApiError(404, "ROOM_NOT_FOUND");
    if (row.host_id === player.id || row.guest_id === player.id) return row.match_id as string;
    if (roomView(row).status === "closed") throw new ApiError(410, "ROOM_CLOSED");
    if (row.guest_id) throw new ApiError(409, "ROOM_FULL");
    await db.query("UPDATE rooms SET guest_id = $2, status = 'full' WHERE code = $1", [code, player.id]);
    await db.query("UPDATE matches SET seat1 = $2 WHERE id = $1", [row.match_id, player.id]);
    return row.match_id as string;
  });
  await pushRoom(code);
  await pushState(matchId);
  return { matchId };
}

export async function cancelRoom(player: Player, code: string): Promise<void> {
  const matchId = await transaction(async (db) => {
    const row = await roomRow(code, db, true);
    if (!row) throw new ApiError(404, "ROOM_NOT_FOUND");
    if (row.host_id !== player.id) throw new ApiError(403, "NOT_HOST");
    const match = await loadMatch(db, row.match_id as string, true);
    if (match?.status !== "waiting") throw new ApiError(409, "MATCH_NOT_WAITING");
    await db.query("UPDATE rooms SET status = 'closed' WHERE code = $1", [code]);
    await db.query("UPDATE matches SET status = 'abandoned', ended_at = now() WHERE id = $1", [row.match_id]);
    return row.match_id as string;
  });
  await pushRoom(code);
  await pushState(matchId);
}

/** Closes rooms nobody joined in time and expires unanswered rematch offers. */
export async function sweepRooms(): Promise<void> {
  const now = new Date();
  const closed = await query(
    "UPDATE rooms SET status = 'closed' WHERE status = 'open' AND expires_at <= $1 RETURNING code, match_id",
    [now],
  );
  for (const room of closed) {
    await query("UPDATE matches SET status = 'abandoned', ended_at = now() WHERE id = $1 AND status = 'waiting'", [room.match_id]);
    await pushRoom(room.code as string);
    await pushState(room.match_id as string);
  }
  const expired = await query("UPDATE rematches SET status = 'expired' WHERE status = 'offered' AND expires_at <= $1 RETURNING match_id, offered_by", [now]);
  for (const offer of expired) {
    hub.toMatch(offer.match_id as string, { type: "rematchStatus", status: "expired", matchId: null, offeredBy: offer.offered_by });
  }
}

type RematchStatus = "offered" | "accepted" | "declined" | "expired";

export function rematch(player: Player, matchId: string, accept: boolean): Promise<{ status: RematchStatus; matchId: string | null }> {
  return locks.run(`rematch:${matchId}`, async () => {
    const outcome = await transaction(async (db) => {
      const match = await loadMatch(db, matchId, true);
      if (!match) throw new ApiError(404, "NOT_FOUND");
      const seat = seatOf(match, player.id);
      if (!match.state.finished || !match.roomCode || match.status === "abandoned") {
        throw new ApiError(409, "REMATCH_UNAVAILABLE");
      }
      const found = await rows(db, "SELECT * FROM rematches WHERE match_id = $1 FOR UPDATE", [matchId]);
      let offer = found[0];
      if (offer?.status === "offered" && (offer.expires_at as Date).getTime() <= Date.now()) {
        await db.query("UPDATE rematches SET status = 'expired' WHERE match_id = $1", [matchId]);
        offer = { ...offer, status: "expired" };
      }
      if (offer?.status === "accepted") return { status: "accepted" as const, matchId: offer.new_match_id as string, offeredBy: offer.offered_by as Seat };
      const standing = offer?.status === "offered";
      if (!standing) {
        if (!accept) return { status: "declined" as const, matchId: null, offeredBy: seat };
        const expires = new Date(Date.now() + config.rematchSeconds * 1000);
        await db.query(
          `INSERT INTO rematches (match_id, offered_by, status, expires_at) VALUES ($1, $2, 'offered', $3)
           ON CONFLICT (match_id) DO UPDATE SET offered_by = $2, status = 'offered', expires_at = $3, new_match_id = NULL`,
          [matchId, seat, expires],
        );
        return { status: "offered" as const, matchId: null, offeredBy: seat };
      }
      const offeredBy = offer?.offered_by as Seat;
      if (!accept) {
        await db.query("UPDATE rematches SET status = 'declined' WHERE match_id = $1", [matchId]);
        return { status: "declined" as const, matchId: null, offeredBy };
      }
      if (offeredBy === seat) return { status: "offered" as const, matchId: null, offeredBy };
      const breaker = otherSeat((match.firstBreaker ?? 0) as Seat);
      const created = await insertMatch(db, {
        mode: "private",
        format: match.format,
        seats: match.seats,
        status: "active",
        state: newMatchState(match.format, breaker),
        roomCode: match.roomCode,
        firstBreaker: breaker,
      });
      await db.query("UPDATE rooms SET match_id = $2 WHERE code = $1", [match.roomCode, created]);
      await db.query("UPDATE rematches SET status = 'accepted', new_match_id = $2 WHERE match_id = $1", [matchId, created]);
      return { status: "accepted" as const, matchId: created, offeredBy };
    });
    hub.toMatch(matchId, { type: "rematchStatus", status: outcome.status, matchId: outcome.matchId, offeredBy: outcome.offeredBy });
    const view = await loadMatch(null, matchId);
    if (view) hub.toMatch(matchId, { type: "state", match: await matchJson(view) });
    return { status: outcome.status, matchId: outcome.matchId };
  });
}

/** Gives a grading-made private match its room, so the code opens the same lobby route. */
export function createRoomForMatch(db: Db, matchId: string, format: Format, seats: [string, string]): Promise<string> {
  return insertRoom(db, { format, hostId: seats[0], guestId: seats[1], matchId, status: "full" });
}
