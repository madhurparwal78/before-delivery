import type { PoolClient } from 'pg';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  QuestionContent,
  RoomSnapshot,
  SeatRecord,
  Standing,
  RevealPayload,
  StoredQuestion,
} from './domain.ts';
import { errors } from './errors.ts';
import { presignedGet } from './images.ts';
import { loadSeats } from './db.ts';

export const MAX_SEATS = 200;

export function now(): number {
  return Date.now();
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function newRejoinToken(): string {
  return randomBytes(24).toString('hex');
}

export function newClientId(): string {
  return randomBytes(24).toString('hex');
}

// ---------- sequence item ids: opaque, position-blind ----------
const ITEM_ID_SALT = 'lastbell-sequence-item';

export function itemIdFor(questionId: string, label: string): string {
  const digest = createHash('sha256').update(`${ITEM_ID_SALT}:${questionId}:${label}`).digest('hex');
  return digest.slice(0, 16);
}

// ---------- scoring: the single place for points ----------
export function longestIncreasingSubsequence(positions: number[]): number {
  const n = positions.length;
  if (n === 0) return 0;
  const tails: number[] = [];
  for (const p of positions) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < p) lo = mid + 1;
      else hi = mid;
    }
    if (lo === tails.length) tails.push(p);
    else tails[lo] = p;
  }
  return tails.length;
}

export interface ScoredAnswer {
  points: number;
  outcome: 'correct' | 'partial' | 'wrong' | 'none';
  streak: number;
}

export function scoreAnswer(
  content: QuestionContent,
  answer: { choice: number | null; estimate: number | null; order: string[] | null } | null,
  latencyMs: number,
  windowMs: number,
  previousStreak: number,
  questionId: string,
): ScoredAnswer {
  if (!answer) {
    return { points: 0, outcome: 'none', streak: 0 };
  }
  const base = 1000 - Math.floor((500 * latencyMs) / windowMs);
  let fullyCorrect = false;
  let partialShare = 0;
  if (content.type === 'multiple_choice') {
    fullyCorrect = answer.choice !== null && answer.choice === content.correctIndex;
  } else if (content.type === 'estimate') {
    fullyCorrect =
      answer.estimate !== null && Math.abs(answer.estimate - content.answer) <= content.tolerance;
  } else {
    const correctPositions = new Map(content.items.map((label, i) => [itemIdFor(questionId, label), i]));
    const positions = (answer.order ?? [])
      .map((id) => correctPositions.get(id))
      .filter((p): p is number => p !== undefined);
    if (positions.length === content.items.length) {
      const k = longestIncreasingSubsequence(positions);
      const n = content.items.length;
      if (k === n) {
        fullyCorrect = true;
      } else {
        partialShare = k / n;
      }
    }
  }
  if (fullyCorrect) {
    const streak = previousStreak + 1;
    const multiplierNumerator = 10 + Math.min(streak - 1, 5);
    return { points: Math.floor((base * multiplierNumerator) / 10), outcome: 'correct', streak };
  }
  if (partialShare > 0) {
    return { points: Math.floor(base * partialShare), outcome: 'partial', streak: 0 };
  }
  return { points: 0, outcome: 'wrong', streak: 0 };
}

// ---------- ranking: the single place for rank order ----------
export function rankSeats(seats: SeatRecord[]): Standing[] {
  const ordered = [...seats].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.cumulativeMs !== b.cumulativeMs) return a.cumulativeMs - b.cumulativeMs;
    return a.joinedAt - b.joinedAt;
  });
  return ordered.map((seat, i) => ({
    rank: i + 1,
    seatId: seat.seatId,
    nickname: seat.nickname,
    score: seat.score,
    streak: seat.streak,
  }));
}

// ---------- reveal computation ----------
export function sequenceBucketStats(
  items: string[],
  questionId: string,
  order: string[] | null,
): number {
  const correctPositions = new Map(items.map((label, i) => [itemIdFor(questionId, label), i]));
  const positions = (order ?? [])
    .map((id) => correctPositions.get(id))
    .filter((p): p is number => p !== undefined);
  return longestIncreasingSubsequence(positions);
}

export async function computeReveal(
  db: PoolClient,
  room: RoomSnapshot,
  questionIndex: number,
): Promise<RevealPayload> {
  const question = room.questions[questionIndex - 1];
  if (!question) throw errors.notFound();
  const seats = await loadSeats(db, room.id);
  const answersResult = await db.query(
    `select * from answers where room_id = $1 and question_index = $2`,
    [room.id, questionIndex],
  );
  const bySeat = new Map<string, {
    choice: number | null; estimate: number | null; order: string[] | null;
    latencyMs: number; remainingMs: number; points: number | null;
  }>();
  for (const row of answersResult.rows as Record<string, unknown>[]) {
    const seatId = String(row.seat_id);
    bySeat.set(seatId, {
      choice: typeof row.choice === 'number' ? row.choice : null,
      estimate: typeof row.estimate === 'number' ? row.estimate : null,
      order: Array.isArray(row.order) ? (row.order as string[]) : null,
      latencyMs: Number(row.latency_ms),
      remainingMs: 0,
      points: null,
    });
  }
  const windowMs = question.timeLimitSeconds * 1000;
  const content = question.content;
  const results: RevealPayload['results'] = [];
  const updatedSeats: { seatId: string; score: number; streak: number; cumulativeMs: number; points: number }[] = [];

  for (const seat of seats) {
    const answer = bySeat.get(seat.seatId) ?? null;
    const scored = scoreAnswer(content, answer, answer ? answer.latencyMs : 0, windowMs, seat.streak, question.id);
    const newScore = seat.score + scored.points;
    const newCumulative = seat.cumulativeMs + (answer ? answer.latencyMs : windowMs);
    results.push({ seatId: seat.seatId, points: scored.points, outcome: scored.outcome, streak: scored.streak });
    updatedSeats.push({ seatId: seat.seatId, score: newScore, streak: scored.streak, cumulativeMs: newCumulative, points: scored.points });
  }

  for (const seat of updatedSeats) {
    await db.query(
      `update seats set score = $3, streak = $4, cumulative_ms = $5 where id = $1 and room_id = $2`,
      [seat.seatId, room.id, seat.score, seat.streak, seat.cumulativeMs],
    );
    await db.query(
      `update answers set points = $4 where room_id = $1 and seat_id = $2 and question_index = $3`,
      [room.id, seat.seatId, questionIndex, seat.points],
    );
  }

  const refreshed = await loadSeats(db, room.id);
  const standings = rankSeats(refreshed);
  for (const standing of standings) {
    await db.query(
      `insert into standings (room_id, seat_id, nickname, score, streak, cumulative_ms, rank)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (room_id, seat_id)
       do update set nickname = excluded.nickname, score = excluded.score,
         streak = excluded.streak, cumulative_ms = excluded.cumulative_ms, rank = excluded.rank`,
      [room.id, standing.seatId, standing.nickname, standing.score, standing.streak,
        refreshed.find((s) => s.seatId === standing.seatId)?.cumulativeMs ?? 0, standing.rank],
    );
    await db.query(`update seats set rank = $2 where id = $1`, [standing.seatId, standing.rank]);
  }

  const answered = bySeat.size;
  const reveal: RevealPayload = {
    questionIndex,
    type: content.type,
    answered,
    seated: seats.length,
    results,
  };

  if (content.type === 'multiple_choice') {
    const counts = new Array(content.options.length).fill(0);
    for (const row of bySeat.values()) {
      if (row.choice !== null && row.choice >= 0 && row.choice < counts.length) counts[row.choice] += 1;
    }
    reveal.counts = counts;
    reveal.correctIndex = content.correctIndex;
  } else if (content.type === 'estimate') {
    const width = (content.max - content.min) / 8;
    const bins: { from: number; to: number; count: number }[] = [];
    for (let i = 0; i < 8; i += 1) {
      bins.push({ from: content.min + i * width, to: content.min + (i + 1) * width, count: 0 });
    }
    for (const row of bySeat.values()) {
      const value = row.estimate;
      if (value === null) continue;
      let idx = Math.floor((value - content.min) / width);
      if (idx < 0) idx = 0;
      if (idx > 7) idx = 7;
      bins[idx].count += 1;
    }
    const bandLow = content.answer - content.tolerance;
    const bandHigh = content.answer + content.tolerance;
    const inBandBins = bins
      .map((bin, i) => ({ i, overlap: bin.to >= bandLow && bin.from <= bandHigh }))
      .filter((entry) => entry.overlap)
      .map((entry) => entry.i);
    reveal.bins = bins;
    reveal.answer = content.answer;
    reveal.tolerance = content.tolerance;
    reveal.inBandBins = inBandBins;
  } else {
    const n = content.items.length;
    const buckets = new Array(n + 1).fill(0);
    for (const seat of seats) {
      const answer = bySeat.get(seat.seatId);
      if (!answer) {
        buckets[0] += 1;
        continue;
      }
      const k = sequenceBucketStats(content.items, question.id, answer.order);
      buckets[Math.min(k, n)] += 1;
    }
    reveal.buckets = buckets;
    reveal.correctOrder = content.items.map((label) => itemIdFor(question.id, label));
  }
  return reveal;
}

export async function presignedQuestionImage(question: StoredQuestion | undefined): Promise<string | null> {
  if (!question || !question.image) return null;
  try {
    return await presignedGet(question.image.objectKey);
  } catch {
    return null;
  }
}
