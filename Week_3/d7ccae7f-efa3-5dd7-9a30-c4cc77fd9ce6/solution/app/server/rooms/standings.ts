import type { Standings } from "../../shared/schemas.js";
import type { Db, Tx } from "../db.js";
import { rankSeats } from "../ranking.js";

type SeatRow = { id: string; nickname: string; score: number; streak: number; cumulative_ms: string; join_seq: number };

// Re-ranks every seat of the room and rewrites its standings rows.
export async function rewriteStandings(tx: Tx, roomId: string): Promise<Standings> {
  const seats = await tx.query<SeatRow>("SELECT id, nickname, score, streak, cumulative_ms, join_seq FROM seats WHERE room_id = $1", [roomId]);
  const ranked = rankSeats(
    seats.rows.map((seat) => ({
      seatId: seat.id,
      nickname: seat.nickname,
      score: seat.score,
      streak: seat.streak,
      cumulativeMs: Number(seat.cumulative_ms),
      joinSeq: seat.join_seq,
    })),
  );
  await tx.query(
    `INSERT INTO standings (room_id, seat_id, nickname, score, streak, cumulative_ms, rank)
     SELECT $1, * FROM unnest($2::uuid[], $3::text[], $4::int[], $5::int[], $6::bigint[], $7::int[])
     ON CONFLICT (room_id, seat_id) DO UPDATE SET score = EXCLUDED.score, streak = EXCLUDED.streak,
       cumulative_ms = EXCLUDED.cumulative_ms, rank = EXCLUDED.rank`,
    [
      roomId,
      ranked.map((s) => s.seatId),
      ranked.map((s) => s.nickname),
      ranked.map((s) => s.score),
      ranked.map((s) => s.streak),
      ranked.map((s) => s.cumulativeMs),
      ranked.map((s) => s.rank),
    ],
  );
  return ranked.map((s) => ({ rank: s.rank, seatId: s.seatId, nickname: s.nickname, score: s.score, streak: s.streak }));
}

export async function readStandings(db: Db | Tx, roomId: string): Promise<Standings> {
  const rows = await db.query<{ rank: number; seat_id: string; nickname: string; score: number; streak: number }>(
    "SELECT rank, seat_id, nickname, score, streak FROM standings WHERE room_id = $1 ORDER BY rank",
    [roomId],
  );
  return rows.rows.map((r) => ({ rank: r.rank, seatId: r.seat_id, nickname: r.nickname, score: r.score, streak: r.streak }));
}
