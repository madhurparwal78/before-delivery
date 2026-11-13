import { createHash } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type {
  HostRoom,
  PlayerQuestion,
  PlayerView,
  PresenceEntry,
  Reveal,
  RoomState,
  Standing,
} from '../../shared/protocol.js';
import { query, type Tx } from '../db/pool.js';
import { notFound } from '../errors.js';
import { presignPictureUrl } from '../images/minio.js';
import { rankSeats } from '../domain/ranking.js';
import { parseSnapshot, playerQuestion, type SnapshotQuestion } from '../domain/room.js';
import type { EventDraft } from '../live/events.js';
import { liveIsUp } from '../live/valkey.js';

export interface RoomRow {
  id: string;
  quizmaster_id: string;
  deck_title: string;
  pin: string;
  state: RoomState;
  questions: unknown;
  question_index: number | null;
  opens_at: string | null;
  deadline_at: string | null;
  shuffled_ids: unknown;
  next_event_id: string;
  presence_hash: string | null;
  ended_at: Date | null;
}

const ROOM_COLUMNS = `id, quizmaster_id, deck_title, pin, state, questions, question_index,
  opens_at, deadline_at, shuffled_ids, next_event_id, presence_hash, ended_at`;

export interface Room {
  row: RoomRow;
  questions: SnapshotQuestion[];
  opensAt: number | null;
  deadlineAt: number | null;
  shuffledIds: string[];
  lastEventId: number;
}

function hydrate(row: RoomRow): Room {
  return {
    row,
    questions: parseSnapshot(row.questions),
    opensAt: row.opens_at === null ? null : Number(row.opens_at),
    deadlineAt: row.deadline_at === null ? null : Number(row.deadline_at),
    shuffledIds: Array.isArray(row.shuffled_ids)
      ? row.shuffled_ids.filter((id): id is string => typeof id === 'string')
      : [],
    lastEventId: Number(row.next_event_id) - 1,
  };
}

export async function lockRoom(tx: Tx, roomId: string): Promise<Room | null> {
  const row = await tx.queryOne<RoomRow>(
    `SELECT ${ROOM_COLUMNS} FROM rooms WHERE id = $1 FOR UPDATE`,
    [roomId],
  );
  return row ? hydrate(row) : null;
}

export async function readRoom(roomId: string): Promise<Room | null> {
  const rows = await query<RoomRow>(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE id = $1`, [roomId]);
  const first = rows[0];
  return first ? hydrate(first) : null;
}

export async function readOwnedRoom(roomId: string, quizmasterId: string): Promise<Room> {
  const room = await readRoom(roomId);
  if (!room || room.row.quizmaster_id !== quizmasterId) throw notFound();
  return room;
}

export interface SeatPresence {
  seatId: string;
  nickname: string;
  score: number;
  streak: number;
  cumulativeMs: number;
  joinSeq: number;
  joinedAfterIndex: number;
  connected: boolean;
}

interface SeatRow {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  cumulative_ms: string;
  join_seq: string;
  joined_after_index: number;
  connected: boolean;
}

/** A stream counts while it is open; a backup-link client counts while it keeps polling. */
const CONNECTED_CLIENT = `(
  (c.stream_open AND c.stream_seen_at > now() - interval '45 seconds')
  OR c.last_poll_at > now() - interval '30 seconds'
)`;

const SEAT_QUERY = `
  SELECT s.id, s.nickname, s.score, s.streak, s.cumulative_ms, s.join_seq, s.joined_after_index,
    EXISTS (
      SELECT 1 FROM room_clients c
      WHERE c.seat_id = s.id AND NOT c.retired AND ${CONNECTED_CLIENT}
    ) AS connected
  FROM seats s WHERE s.room_id = $1 ORDER BY s.join_seq`;

const CLIENT_COUNT_QUERY = `
  SELECT count(*)::int AS total FROM room_clients c
  WHERE c.room_id = $1 AND NOT c.retired AND ${CONNECTED_CLIENT}`;

export interface Presence {
  seats: SeatPresence[];
  standings: (Standing & { cumulativeMs: number })[];
  connectedPhones: number;
  liveClients: number;
}

type Runner = <T extends QueryResultRow>(
  text: string,
  params?: readonly unknown[],
) => Promise<T[]>;

function runner(tx?: Tx): Runner {
  return tx ? ((text, params) => tx.query(text, params)) : ((text, params) => query(text, params));
}

export async function readPresence(roomId: string, tx?: Tx): Promise<Presence> {
  const run = runner(tx);
  const seatRows = await run<SeatRow>(SEAT_QUERY, [roomId]);
  const counts = await run<{ total: number }>(CLIENT_COUNT_QUERY, [roomId]);
  const seats: SeatPresence[] = seatRows.map((row) => ({
    seatId: row.id,
    nickname: row.nickname,
    score: row.score,
    streak: row.streak,
    cumulativeMs: Number(row.cumulative_ms),
    joinSeq: Number(row.join_seq),
    joinedAfterIndex: row.joined_after_index,
    connected: row.connected,
  }));
  return {
    seats,
    standings: rankSeats(seats),
    connectedPhones: seats.filter((seat) => seat.connected).length,
    liveClients: counts[0]?.total ?? 0,
  };
}

function presenceEntries(presence: Presence): PresenceEntry[] {
  return presence.seats.map((seat) => ({
    seatId: seat.seatId,
    nickname: seat.nickname,
    connected: seat.connected,
  }));
}

export interface PresencePayload {
  seated: number;
  connected: number;
  players: PresenceEntry[];
}

export function presencePayload(presence: Presence): PresencePayload {
  return {
    seated: presence.seats.length,
    connected: presence.connectedPhones,
    players: presenceEntries(presence),
  };
}

export function hashPresence(payload: PresencePayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Emits a presence event when the room's connected picture has moved on. */
export async function syncPresence(tx: Tx, room: Room): Promise<EventDraft[]> {
  const presence = await readPresence(room.row.id, tx);
  const payload = presencePayload(presence);
  const hash = hashPresence(payload);
  await tx.query(
    `UPDATE rooms SET presence_hash = $2,
       empty_since = CASE WHEN $3::int = 0 THEN COALESCE(empty_since, now()) ELSE NULL END
     WHERE id = $1`,
    [room.row.id, hash, presence.liveClients],
  );
  if (hash === room.row.presence_hash) return [];
  room.row.presence_hash = hash;
  return [{ type: 'presence', data: payload }];
}

export async function answeredCount(
  roomId: string,
  questionIndex: number | null,
  tx?: Tx,
): Promise<number> {
  if (questionIndex === null) return 0;
  const rows = await runner(tx)<{ total: number }>(
    'SELECT count(*)::int AS total FROM answers WHERE room_id = $1 AND question_index = $2',
    [roomId, questionIndex],
  );
  return rows[0]?.total ?? 0;
}

async function readReveal(roomId: string, questionIndex: number | null): Promise<Reveal | null> {
  if (questionIndex === null) return null;
  const rows = await query<{ data: Reveal }>(
    'SELECT data FROM room_reveals WHERE room_id = $1 AND question_index = $2',
    [roomId, questionIndex],
  );
  return rows[0]?.data ?? null;
}

const STATES_WITH_QUESTION: RoomState[] = ['question_open', 'locked', 'reveal'];
const STATES_WITH_REVEAL: RoomState[] = ['reveal', 'leaderboard'];

export function currentQuestion(room: Room): SnapshotQuestion | null {
  if (room.row.question_index === null) return null;
  return room.questions[room.row.question_index - 1] ?? null;
}

/** The question payload for the room's state, with a freshly issued picture link. */
function projectQuestion(room: Room): PlayerQuestion | null {
  if (!STATES_WITH_QUESTION.includes(room.row.state)) return null;
  const question = currentQuestion(room);
  if (!question || room.opensAt === null || room.deadlineAt === null) return null;
  return playerQuestion(
    question,
    room.row.question_index as number,
    room.opensAt,
    room.deadlineAt,
    question.image ? presignPictureUrl(question.image.key) : null,
    room.shuffledIds,
  );
}

async function projectReveal(room: Room): Promise<Reveal | null> {
  if (!STATES_WITH_REVEAL.includes(room.row.state)) return null;
  return readReveal(room.row.id, room.row.question_index);
}

export function toStandings(entries: readonly (Standing & { cumulativeMs: number })[]): Standing[] {
  return entries.map((entry) => ({
    rank: entry.rank,
    seatId: entry.seatId,
    nickname: entry.nickname,
    score: entry.score,
    streak: entry.streak,
  }));
}

export async function hostRoomView(room: Room): Promise<HostRoom> {
  const presence = await readPresence(room.row.id);
  const rankBySeat = new Map(presence.standings.map((entry) => [entry.seatId, entry.rank]));
  return {
    id: room.row.id,
    pin: room.row.pin,
    state: room.row.state,
    deckTitle: room.row.deck_title,
    questionCount: room.questions.length,
    questionIndex: room.row.question_index,
    question: projectQuestion(room),
    answered: await answeredCount(room.row.id, room.row.question_index),
    seated: presence.seats.length,
    connected: presence.connectedPhones,
    players: presence.seats.map((seat) => ({
      seatId: seat.seatId,
      nickname: seat.nickname,
      score: seat.score,
      rank: rankBySeat.get(seat.seatId) ?? presence.seats.length,
      connected: seat.connected,
    })),
    reveal: await projectReveal(room),
    standings: toStandings(presence.standings),
    transport: liveIsUp() ? 'live' : 'backup',
    lastEventId: room.lastEventId,
  };
}

export async function playerRoomView(room: Room, seatId: string): Promise<PlayerView> {
  const presence = await readPresence(room.row.id);
  const mine = presence.standings.find((entry) => entry.seatId === seatId);
  const answered = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM answers
     WHERE room_id = $1 AND seat_id = $2 AND question_index = $3`,
    [room.row.id, seatId, room.row.question_index ?? 0],
  );
  return {
    state: room.row.state,
    questionCount: room.questions.length,
    questionIndex: room.row.question_index,
    question: projectQuestion(room),
    reveal: await projectReveal(room),
    standings: toStandings(presence.standings),
    you: {
      seatId,
      nickname: mine?.nickname ?? '',
      score: mine?.score ?? 0,
      streak: mine?.streak ?? 0,
      rank: mine?.rank ?? presence.seats.length,
      answeredCurrent: (answered[0]?.total ?? 0) > 0,
    },
    lastEventId: room.lastEventId,
  };
}

export async function recordTransition(
  tx: Tx,
  roomId: string,
  command: string | null,
  from: RoomState,
  to: RoomState,
): Promise<void> {
  await tx.query(
    'INSERT INTO room_transitions (room_id, command, from_state, to_state) VALUES ($1, $2, $3, $4)',
    [roomId, command, from, to],
  );
}
