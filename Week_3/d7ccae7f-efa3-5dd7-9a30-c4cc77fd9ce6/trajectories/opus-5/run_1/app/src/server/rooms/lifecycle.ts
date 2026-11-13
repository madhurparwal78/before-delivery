import { randomInt, randomUUID } from 'node:crypto';
import type { HostCommand, RoomState, Standing } from '../../shared/protocol.js';
import { serverNow } from '../clock.js';
import { config } from '../config.js';
import { query, uniqueViolationOn, withTransaction, type Tx } from '../db/pool.js';
import {
  illegalTransition,
  noMoreQuestions,
  notFound,
  validationFailed,
} from '../errors.js';
import { applyCommand } from '../../shared/transitions.js';
import {
  computeReveal,
  parseStoredImage,
  shuffledItemIds,
  snapshotForStorage,
  playerQuestion,
  type RevealAnswer,
  type SnapshotQuestion,
} from '../domain/room.js';
import { parseStoredSpec } from '../domain/questions.js';
import type { Submission } from '../domain/scoring.js';
import { rankSeats } from '../domain/ranking.js';
import { presignPictureUrl } from '../images/minio.js';
import { appendEvents, publishEvents, type EventDraft } from '../live/events.js';
import { expireRoomKeys, writeLeaderboard } from '../live/valkey.js';
import {
  hashPresence,
  lockRoom,
  presencePayload,
  readPresence,
  recordTransition,
  syncPresence,
  toStandings,
  type Room,
} from './store.js';

export interface RoomWork<T> {
  value: T;
  drafts: EventDraft[];
  afterCommit?: () => Promise<void>;
}

export async function withRoomLock<T>(
  roomId: string,
  run: (tx: Tx, room: Room) => Promise<RoomWork<T>>,
): Promise<T> {
  const outcome = await withTransaction(async (tx) => {
    const room = await lockRoom(tx, roomId);
    if (!room) throw notFound();
    const work = await run(tx, room);
    const events = await appendEvents(tx, roomId, work.drafts);
    return { value: work.value, events, afterCommit: work.afterCommit };
  });
  await publishEvents(roomId, outcome.events);
  if (outcome.afterCommit) await outcome.afterCommit();
  return outcome.value;
}

interface DeckQuestionRow {
  id: string;
  position: number;
  version: number;
  type: string;
  prompt: string;
  time_limit_seconds: number;
  spec: unknown;
  image: unknown;
}

export async function openRoom(quizmasterId: string, deckId: string): Promise<string> {
  const deck = await query<{ id: string; title: string }>(
    'SELECT id, title FROM decks WHERE id = $1 AND quizmaster_id = $2',
    [deckId, quizmasterId],
  );
  const found = deck[0];
  if (!found) throw notFound();
  const rows = await query<DeckQuestionRow>(
    `SELECT id, position, version, type, prompt, time_limit_seconds, spec, image
     FROM questions WHERE deck_id = $1 ORDER BY position`,
    [deckId],
  );
  if (rows.length === 0) {
    throw validationFailed({ deckId: 'Deck has no questions' });
  }
  const snapshot = rows.map((row) =>
    snapshotForStorage({
      id: row.id,
      position: row.position,
      version: row.version,
      prompt: row.prompt,
      timeLimitSeconds: row.time_limit_seconds,
      image: parseStoredImage(row.image),
      spec: parseStoredSpec(
        row.type === 'estimate' ? 'estimate' : row.type === 'sequence' ? 'sequence' : 'multiple_choice',
        row.spec,
      ),
    }),
  );
  const roomId = randomUUID();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await query(
        `INSERT INTO rooms (id, quizmaster_id, deck_id, deck_title, pin, state, questions, empty_since)
         VALUES ($1, $2, $3, $4, $5, 'lobby', $6, now())`,
        [roomId, quizmasterId, deckId, found.title, freshPin(), JSON.stringify(snapshot)],
      );
      return roomId;
    } catch (error) {
      if (!uniqueViolationOn(error, 'rooms_live_pin_key')) throw error;
    }
  }
  throw new Error('Could not allocate a free PIN');
}

function freshPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function runHostCommand(
  quizmasterId: string,
  roomId: string,
  command: HostCommand,
): Promise<void> {
  await withRoomLock(roomId, async (tx, room) => {
    if (room.row.quizmaster_id !== quizmasterId) throw notFound();
    const transition = applyCommand(
      {
        state: room.row.state,
        questionIndex: room.row.question_index,
        questionCount: room.questions.length,
      },
      command,
    );
    if (!transition.ok) {
      if (transition.reason === 'no_more_questions') throw noMoreQuestions();
      throw illegalTransition(room.row.state, command);
    }
    return transitionTo(tx, room, command, transition.to, transition.questionIndex);
  });
}

async function transitionTo(
  tx: Tx,
  room: Room,
  command: HostCommand | null,
  to: RoomState,
  questionIndex: number | null,
  reason: 'host' | 'deadline' | 'idle' = 'host',
): Promise<RoomWork<void>> {
  const from = room.row.state;
  await recordTransition(tx, room.row.id, command, from, to);
  const drafts: EventDraft[] = [];
  let afterCommit: (() => Promise<void>) | undefined;

  if (to === 'question_open') {
    const index = questionIndex as number;
    const question = room.questions[index - 1] as SnapshotQuestion;
    const opensAt = serverNow();
    const deadlineAt = opensAt + question.timeLimitSeconds * 1000;
    const presented = shuffledItemIds(question);
    await tx.query(
      `UPDATE rooms SET state = 'question_open', question_index = $2, opens_at = $3,
         deadline_at = $4, shuffled_ids = $5 WHERE id = $1`,
      [room.row.id, index, opensAt, deadlineAt, JSON.stringify(presented)],
    );
    room.row.state = to;
    room.row.question_index = index;
    room.opensAt = opensAt;
    room.deadlineAt = deadlineAt;
    room.shuffledIds = presented;
    drafts.push({
      type: 'question_open',
      data: playerQuestion(
        question,
        index,
        opensAt,
        deadlineAt,
        question.image ? presignPictureUrl(question.image.key) : null,
        presented,
      ),
    });
  } else if (to === 'locked') {
    await tx.query("UPDATE rooms SET state = 'locked' WHERE id = $1", [room.row.id]);
    room.row.state = to;
    drafts.push({
      type: 'locked',
      data: {
        questionIndex: room.row.question_index as number,
        reason: reason === 'deadline' ? 'deadline' : 'host',
      },
    });
  } else if (to === 'reveal') {
    const reveal = await applyReveal(tx, room);
    await tx.query("UPDATE rooms SET state = 'reveal' WHERE id = $1", [room.row.id]);
    room.row.state = to;
    drafts.push({ type: 'reveal', data: reveal.data });
    afterCommit = () => writeLeaderboard(room.row.id, reveal.leaderboard);
  } else if (to === 'leaderboard') {
    await tx.query("UPDATE rooms SET state = 'leaderboard' WHERE id = $1", [room.row.id]);
    room.row.state = to;
    drafts.push({ type: 'leaderboard', data: { standings: await standingsNow(tx, room) } });
  } else if (to === 'podium') {
    await tx.query("UPDATE rooms SET state = 'podium' WHERE id = $1", [room.row.id]);
    room.row.state = to;
    const standings = await standingsNow(tx, room);
    drafts.push({ type: 'podium', data: { top: standings.slice(0, 3), standings } });
  } else if (to === 'ended') {
    await tx.query(
      "UPDATE rooms SET state = 'ended', ended_at = now(), end_reason = $2 WHERE id = $1",
      [room.row.id, reason === 'idle' ? 'idle' : 'host'],
    );
    room.row.state = to;
    await writeFinalStandings(tx, room);
    drafts.push({ type: 'ended', data: { reason: reason === 'idle' ? 'idle' : 'host' } });
    afterCommit = () => expireRoomKeys(room.row.id);
  }
  return { value: undefined, drafts, afterCommit };
}

async function standingsNow(tx: Tx, room: Room): Promise<Standing[]> {
  const presence = await readPresence(room.row.id, tx);
  return toStandings(presence.standings);
}

interface SeatScoreRow {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  joined_after_index: number;
  join_seq: string;
}

async function applyReveal(
  tx: Tx,
  room: Room,
): Promise<{ data: ReturnType<typeof computeReveal>['reveal']; leaderboard: { seatId: string; score: number }[] }> {
  const questionIndex = room.row.question_index as number;
  const question = room.questions[questionIndex - 1] as SnapshotQuestion;
  const seatRows = await tx.query<SeatScoreRow>(
    `SELECT id, nickname, score, streak, joined_after_index, join_seq
     FROM seats WHERE room_id = $1 ORDER BY join_seq`,
    [room.row.id],
  );
  const answerRows = await tx.query<{
    seat_id: string;
    question_index: number;
    latency_ms: number;
    submission: Submission;
  }>(
    'SELECT seat_id, question_index, latency_ms, submission FROM answers WHERE room_id = $1',
    [room.row.id],
  );
  const current = new Map<string, RevealAnswer>();
  for (const row of answerRows) {
    if (row.question_index === questionIndex) {
      current.set(row.seat_id, {
        seatId: row.seat_id,
        latencyMs: row.latency_ms,
        submission: row.submission,
      });
    }
  }
  const seats = seatRows.map((row) => ({
    seatId: row.id,
    nickname: row.nickname,
    streak: row.streak,
    joinedAfterIndex: row.joined_after_index,
  }));
  const { reveal, scored } = computeReveal(question, questionIndex, seats, current);

  const latencyBySeat = new Map<string, Map<number, number>>();
  for (const row of answerRows) {
    if (row.question_index > questionIndex) continue;
    const perSeat = latencyBySeat.get(row.seat_id) ?? new Map<number, number>();
    perSeat.set(row.question_index, row.latency_ms);
    latencyBySeat.set(row.seat_id, perSeat);
  }

  const updated = seatRows.map((row) => {
    const result = scored.get(row.id);
    const points = result?.points ?? 0;
    const streak = result?.streak ?? 0;
    const answered = latencyBySeat.get(row.id) ?? new Map<number, number>();
    let cumulativeMs = 0;
    for (let index = 1; index <= questionIndex; index += 1) {
      const latency = answered.get(index);
      if (latency !== undefined) {
        cumulativeMs += latency;
      } else if (index > row.joined_after_index) {
        cumulativeMs += (room.questions[index - 1]?.timeLimitSeconds ?? 0) * 1000;
      }
    }
    return {
      seatId: row.id,
      nickname: row.nickname,
      score: row.score + points,
      streak,
      cumulativeMs,
      joinSeq: Number(row.join_seq),
      points,
    };
  });

  for (const seat of updated) {
    await tx.query(
      'UPDATE seats SET score = $2, streak = $3, cumulative_ms = $4 WHERE id = $1',
      [seat.seatId, seat.score, seat.streak, seat.cumulativeMs],
    );
    if (current.has(seat.seatId)) {
      await tx.query(
        'UPDATE answers SET points = $4 WHERE room_id = $1 AND seat_id = $2 AND question_index = $3',
        [room.row.id, seat.seatId, questionIndex, seat.points],
      );
    }
  }
  await writeStandings(tx, room.row.id, updated);
  await tx.query(
    `INSERT INTO room_reveals (room_id, question_index, data) VALUES ($1, $2, $3)
     ON CONFLICT (room_id, question_index) DO UPDATE SET data = EXCLUDED.data`,
    [room.row.id, questionIndex, JSON.stringify(reveal)],
  );
  return {
    data: reveal,
    leaderboard: updated.map((seat) => ({ seatId: seat.seatId, score: seat.score })),
  };
}

interface SeatTotals {
  seatId: string;
  nickname: string;
  score: number;
  streak: number;
  cumulativeMs: number;
  joinSeq: number;
}

async function writeStandings(tx: Tx, roomId: string, seats: readonly SeatTotals[]): Promise<void> {
  await tx.query('DELETE FROM standings WHERE room_id = $1', [roomId]);
  const ranked = rankSeats(seats);
  for (const entry of ranked) {
    await tx.query(
      `INSERT INTO standings (room_id, seat_id, nickname, score, streak, cumulative_ms, rank)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        roomId,
        entry.seatId,
        entry.nickname,
        entry.score,
        entry.streak,
        entry.cumulativeMs,
        entry.rank,
      ],
    );
  }
}

/** Seats that joined after the last reveal still belong in the night's results. */
async function writeFinalStandings(tx: Tx, room: Room): Promise<void> {
  const presence = await readPresence(room.row.id, tx);
  await writeStandings(
    tx,
    room.row.id,
    presence.seats.map((seat) => ({
      seatId: seat.seatId,
      nickname: seat.nickname,
      score: seat.score,
      streak: seat.streak,
      cumulativeMs: seat.cumulativeMs,
      joinSeq: seat.joinSeq,
    })),
  );
}

export async function lockExpiredQuestions(): Promise<void> {
  const now = serverNow();
  const rows = await query<{ id: string }>(
    `SELECT id FROM rooms WHERE state = 'question_open' AND ended_at IS NULL AND deadline_at <= $1`,
    [now],
  );
  for (const row of rows) {
    await withRoomLock(row.id, async (tx, room) => {
      if (room.row.state !== 'question_open' || room.deadlineAt === null || room.deadlineAt > serverNow()) {
        return { value: undefined, drafts: [] };
      }
      return transitionTo(tx, room, null, 'locked', room.row.question_index, 'deadline');
    });
  }
}

export async function endIdleRooms(): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM rooms WHERE ended_at IS NULL AND empty_since IS NOT NULL
       AND empty_since <= now() - make_interval(secs => $1)`,
    [config.roomIdleSeconds],
  );
  for (const row of rows) {
    await withRoomLock(row.id, async (tx, room) => {
      if (room.row.state === 'ended') return { value: undefined, drafts: [] };
      return transitionTo(tx, room, null, 'ended', room.row.question_index, 'idle');
    });
  }
}

export async function syncRoomPresence(roomId: string): Promise<void> {
  await withRoomLock(roomId, async (tx, room) => ({
    value: undefined,
    drafts: await syncPresence(tx, room),
  }));
}

/** Reads presence without a transaction and only writes when it has moved on. */
export async function refreshPresence(): Promise<void> {
  const rows = await query<{ id: string; presence_hash: string | null; empty_since: Date | null }>(
    'SELECT id, presence_hash, empty_since FROM rooms WHERE ended_at IS NULL',
  );
  for (const row of rows) {
    const presence = await readPresence(row.id);
    const hash = hashPresence(presencePayload(presence));
    const empty = presence.liveClients === 0;
    if (hash === row.presence_hash && empty === (row.empty_since !== null)) continue;
    await syncRoomPresence(row.id);
  }
}
