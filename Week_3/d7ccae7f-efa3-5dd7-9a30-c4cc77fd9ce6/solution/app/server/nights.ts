import type { NightDetail, NightSummary } from "../shared/schemas.js";
import { pool } from "./db.js";
import { notFound } from "./errors.js";
import { isUuid } from "./ids.js";

type NightRow = { id: string; deck_title: string; ended_at: string };

export async function listNights(quizmasterId: string): Promise<NightSummary[]> {
  const nights = await pool.query<NightRow>(
    "SELECT id, deck_title, ended_at FROM rooms WHERE quizmaster_id = $1 AND state = 'ended' ORDER BY ended_at DESC, created_at DESC",
    [quizmasterId],
  );
  const ids = nights.rows.map((night) => night.id);
  const standings = await pool.query<{ room_id: string; rank: number; nickname: string; score: number }>(
    "SELECT room_id, rank, nickname, score FROM standings WHERE room_id = ANY($1::uuid[]) ORDER BY rank",
    [ids],
  );
  return nights.rows.map((night) => {
    const own = standings.rows.filter((row) => row.room_id === night.id);
    return {
      roomId: night.id,
      deckTitle: night.deck_title,
      endedAt: Number(night.ended_at),
      seated: own.length,
      podium: own.slice(0, 3).map(({ rank, nickname, score }) => ({ rank, nickname, score })),
    };
  });
}

export async function readNight(quizmasterId: string, roomId: string): Promise<NightDetail> {
  if (!isUuid(roomId)) throw notFound();
  const night = await pool.query<NightRow>("SELECT id, deck_title, ended_at FROM rooms WHERE id = $1 AND quizmaster_id = $2 AND state = 'ended'", [roomId, quizmasterId]);
  const row = night.rows[0];
  if (!row) throw notFound();
  const standings = await pool.query<{ rank: number; nickname: string; score: number }>("SELECT rank, nickname, score FROM standings WHERE room_id = $1 ORDER BY rank", [roomId]);
  return { roomId, deckTitle: row.deck_title, endedAt: Number(row.ended_at), standings: standings.rows.map(({ rank, nickname, score }) => ({ rank, nickname, score })) };
}
