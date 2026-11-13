import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { NICKNAME_MAX, PIN_LENGTH, SEAT_LIMIT } from "../../shared/schemas.js";
import { nowMs } from "../clock.js";
import { isUniqueViolation, transaction } from "../db.js";
import { apiError, fieldsOf, validationFailed } from "../errors.js";
import { sha256Hex } from "../hash.js";
import { publishSuperseded, writeScores } from "../live/valkey.js";
import { retire } from "../presence.js";
import { announce, appendEvent } from "./events.js";
import { rewriteStandings } from "./standings.js";

const joinBody = z.object({
  pin: z.string("PIN must be six digits").regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), "PIN must be six digits"),
  nickname: z
    .string("Nickname is required")
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, "Nickname must be 1 to 20 characters")
        .max(NICKNAME_MAX, "Nickname must be 1 to 20 characters")
        .refine((value) => !/\p{Cc}/u.test(value), "Nickname cannot contain control characters"),
    ),
});

const hashRejoinToken = (token: string): string => sha256Hex(token);
const newSecret = (): string => randomBytes(32).toString("base64url");

// The malformed-input check runs before any lookup: a bad PIN is 422, never room_not_found.
function parseJoin(body: unknown): z.infer<typeof joinBody> {
  const parsed = joinBody.safeParse(body);
  if (parsed.success) return parsed.data;
  throw validationFailed(fieldsOf(parsed.error));
}

export async function joinRoom(body: unknown): Promise<{ roomId: string; seatId: string; nickname: string; rejoinToken: string; clientId: string }> {
  const { pin, nickname } = parseJoin(body);
  const rejoinToken = newSecret();
  const clientId = newSecret();
  const seatId = randomUUID();
  const joined = await transaction(async (tx) => {
    const room = await tx.query<{ id: string; state: string }>("SELECT id, state FROM rooms WHERE pin = $1 AND state <> 'ended' FOR UPDATE", [pin]);
    const found = room.rows[0];
    if (!found) throw apiError(404, "room_not_found");
    if (found.state === "podium") throw apiError(409, "room_closed");
    const counts = await tx.query<{ seated: number; next_seq: number }>("SELECT count(*)::int AS seated, coalesce(max(join_seq), 0)::int + 1 AS next_seq FROM seats WHERE room_id = $1", [found.id]);
    const { seated, next_seq: joinSeq } = counts.rows[0] as { seated: number; next_seq: number };
    if (seated >= SEAT_LIMIT) throw apiError(409, "room_full");
    try {
      await tx.query(
        `INSERT INTO seats (id, room_id, nickname, nickname_key, rejoin_token_hash, join_seq, joined_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [seatId, found.id, nickname, nickname.toLowerCase(), hashRejoinToken(rejoinToken), joinSeq, nowMs()],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw apiError(409, "nickname_taken");
      throw error;
    }
    await tx.query("INSERT INTO clients (client_id, seat_id, room_id) VALUES ($1, $2, $3)", [clientId, seatId, found.id]);
    await rewriteStandings(tx, found.id);
    const event = await appendEvent(tx, found.id, { type: "player_joined", data: { seatId, nickname, seated: seated + 1 } });
    return { roomId: found.id, event };
  });
  await announce(joined.roomId, [joined.event]);
  await writeScores(joined.roomId, [{ seatId, score: 0 }]);
  return { roomId: joined.roomId, seatId, nickname, rejoinToken, clientId };
}

const rejoinBody = z.object({ rejoinToken: z.string("Rejoin token is required") });

export function parseRejoin(body: unknown): string {
  const parsed = rejoinBody.safeParse(body);
  if (!parsed.success) throw validationFailed({ rejoinToken: "Rejoin token is required" });
  return parsed.data.rejoinToken;
}

// A rejoin token restores exactly its own seat and retires every earlier client of that seat.
export async function rejoinSeat(token: string): Promise<{ roomId: string; seatId: string; nickname: string; score: number; streak: number; clientId: string }> {
  const clientId = newSecret();
  const result = await transaction(async (tx) => {
    const seat = await tx.query<{ id: string; room_id: string; nickname: string; score: number; streak: number; state: string }>(
      `SELECT s.id, s.room_id, s.nickname, s.score, s.streak, r.state FROM seats s JOIN rooms r ON r.id = s.room_id
       WHERE s.rejoin_token_hash = $1 FOR UPDATE OF s`,
      [hashRejoinToken(token)],
    );
    const row = seat.rows[0];
    if (!row) throw apiError(401, "invalid_rejoin_token");
    if (row.state === "ended") throw apiError(410, "room_ended");
    const retired = await tx.query<{ client_id: string }>("UPDATE clients SET retired = true WHERE seat_id = $1 AND NOT retired RETURNING client_id", [row.id]);
    await tx.query("INSERT INTO clients (client_id, seat_id, room_id) VALUES ($1, $2, $3)", [clientId, row.id, row.room_id]);
    return { row, retired: retired.rows.map((r) => r.client_id) };
  });
  retire(result.row.room_id, result.retired);
  await publishSuperseded(result.row.room_id, result.retired);
  const { row } = result;
  return { roomId: row.room_id, seatId: row.id, nickname: row.nickname, score: row.score, streak: row.streak, clientId };
}
