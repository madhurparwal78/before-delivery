import { showsQuestion, showsReveal } from "../../shared/machine.js";
import type { HostRoom, PlayerQuestion, PlayerView, Reveal, RoomState, Standings } from "../../shared/schemas.js";
import { pool } from "../db.js";
import { notFound } from "../errors.js";
import { isLive } from "../live/valkey.js";
import { connectedSeats } from "../presence.js";
import { ROOM_QUESTION_COLUMNS, playerQuestion, readRoomQuestion, type RoomQuestionRow } from "./snapshot.js";
import { readStandings } from "./standings.js";

type RoomRow = {
  id: string;
  quizmaster_id: string;
  pin: string;
  state: RoomState;
  deck_title: string;
  question_index: number | null;
  question_count: number;
  last_event_id: string;
};

async function readRoom(roomId: string): Promise<RoomRow> {
  const result = await pool.query<RoomRow>(
    "SELECT id, quizmaster_id, pin, state, deck_title, question_index, question_count, last_event_id FROM rooms WHERE id = $1",
    [roomId],
  );
  const row = result.rows[0];
  if (!row) throw notFound();
  return row;
}

type Common = { room: RoomRow; question: PlayerQuestion | null; reveal: Reveal | null; standings: Standings };

// What every client may see of the room: the question only while one is on the table, the reveal only from its step on.
async function readCommon(roomId: string): Promise<Common> {
  const room = await readRoom(roomId);
  let question: PlayerQuestion | null = null;
  let reveal: Reveal | null = null;
  if (room.question_index !== null && (showsQuestion(room.state) || showsReveal(room.state))) {
    const row = await pool.query<RoomQuestionRow>(`SELECT ${ROOM_QUESTION_COLUMNS} FROM room_questions WHERE room_id = $1 AND index = $2`, [roomId, room.question_index]);
    const stored = readRoomQuestion(row.rows[0] as RoomQuestionRow);
    if (showsQuestion(room.state)) question = playerQuestion(stored);
    if (showsReveal(room.state)) reveal = stored.reveal;
  }
  return { room, question, reveal, standings: await readStandings(pool, roomId) };
}

async function answeredCount(roomId: string, questionIndex: number | null): Promise<number> {
  if (questionIndex === null) return 0;
  const result = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM answers WHERE room_id = $1 AND question_index = $2", [roomId, questionIndex]);
  return result.rows[0]?.n ?? 0;
}

export async function loadHostRoom(roomId: string): Promise<HostRoom> {
  const { room, question, reveal, standings } = await readCommon(roomId);
  const connected = connectedSeats(roomId);
  const seats = await pool.query<{ id: string }>("SELECT id FROM seats WHERE room_id = $1 ORDER BY join_seq", [roomId]);
  const rankOf = new Map(standings.map((s) => [s.seatId, s]));
  return {
    id: room.id,
    pin: room.pin,
    state: room.state,
    deckTitle: room.deck_title,
    questionCount: room.question_count,
    questionIndex: room.question_index,
    question,
    answered: await answeredCount(roomId, room.question_index),
    seated: seats.rows.length,
    connected: connected.size,
    players: seats.rows.map(({ id }) => {
      const standing = rankOf.get(id) as Standings[number];
      return { seatId: id, nickname: standing.nickname, score: standing.score, rank: standing.rank, connected: connected.has(id) };
    }),
    reveal,
    standings,
    transport: isLive() ? "live" : "backup",
    lastEventId: Number(room.last_event_id),
  };
}

export async function loadPlayerView(roomId: string, seatId: string): Promise<PlayerView> {
  const { room, question, reveal, standings } = await readCommon(roomId);
  const mine = standings.find((s) => s.seatId === seatId) as Standings[number];
  const answered = await pool.query("SELECT 1 FROM answers WHERE room_id = $1 AND seat_id = $2 AND question_index = $3", [roomId, seatId, room.question_index]);
  return {
    state: room.state,
    questionCount: room.question_count,
    questionIndex: room.question_index,
    question,
    reveal,
    standings,
    you: {
      seatId,
      nickname: mine.nickname,
      score: mine.score,
      streak: mine.streak,
      rank: mine.rank,
      answeredCurrent: (answered.rowCount ?? 0) > 0,
    },
    lastEventId: Number(room.last_event_id),
  };
}
