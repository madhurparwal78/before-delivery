import { z } from "zod";
import type { Reveal, Standings } from "../../shared/schemas.js";
import type { Tx } from "../db.js";
import { scoreAnswer, type Given, type Scored, type ScoredQuestion } from "../scoring.js";
import { ROOM_QUESTION_COLUMNS, readRoomQuestion, type RoomQuestion, type RoomQuestionRow } from "./snapshot.js";
import { rewriteStandings } from "./standings.js";

const BIN_COUNT = 8;

const givenSchema = z.union([
  z.object({ choice: z.number().int() }),
  z.object({ estimate: z.number() }),
  z.object({ order: z.array(z.string()) }),
]);

type SeatRow = { id: string; score: number; streak: number; cumulative_ms: string; joined_at: string };
type AnswerRow = { seat_id: string; latency_ms: number; given: unknown };

function scoredQuestion(question: RoomQuestion): ScoredQuestion {
  switch (question.type) {
    case "multiple_choice":
      return { type: "multiple_choice", correctIndex: question.correctIndex };
    case "estimate":
      return { type: "estimate", answer: question.answer, tolerance: question.tolerance };
    case "sequence":
      return { type: "sequence", correctOrder: question.items.map((item) => item.id) };
  }
}

function estimateBin(value: number, min: number, max: number): number {
  return Math.min(BIN_COUNT - 1, Math.floor(((value - min) / (max - min)) * BIN_COUNT));
}

type Settled = Scored & { seatId: string; given: Given | null; latencyMs: number | null };

function numbers(question: RoomQuestion, settled: Settled[], answered: number, seated: number): Reveal {
  const common = {
    questionIndex: question.index,
    answered,
    seated,
    results: settled.map(({ seatId, points, outcome, streak }) => ({ seatId, points, outcome, streak })),
  };
  switch (question.type) {
    case "multiple_choice": {
      const counts = question.options.map(() => 0);
      for (const { given } of settled) if (given && "choice" in given) counts[given.choice]++;
      return { ...common, type: "multiple_choice", counts, correctIndex: question.correctIndex };
    }
    case "estimate": {
      const width = (question.max - question.min) / BIN_COUNT;
      const bins = Array.from({ length: BIN_COUNT }, (_, k) => ({ from: question.min + k * width, to: question.min + (k + 1) * width, count: 0 }));
      for (const { given } of settled) {
        if (given && "estimate" in given) bins[estimateBin(given.estimate, question.min, question.max)].count++;
      }
      const low = question.answer - question.tolerance;
      const high = question.answer + question.tolerance;
      const inBandBins = bins.flatMap((bin, k) => (bin.from <= high && (k === BIN_COUNT - 1 ? low <= bin.to : low < bin.to) ? [k] : []));
      return { ...common, type: "estimate", bins, answer: question.answer, tolerance: question.tolerance, inBandBins };
    }
    case "sequence": {
      const buckets = question.items.map(() => 0).concat([0]);
      for (const { inPlace } of settled) buckets[inPlace ?? 0]++;
      return { ...common, type: "sequence", buckets, correctOrder: question.items.map((item) => item.id) };
    }
  }
}

// Scores every seat for the question that was just locked, stores points, totals and standings, and returns the reveal.
export async function settleQuestion(tx: Tx, roomId: string, questionIndex: number): Promise<{ reveal: Reveal; standings: Standings; scores: { seatId: string; score: number }[] }> {
  const questionRow = await tx.query<RoomQuestionRow>(`SELECT ${ROOM_QUESTION_COLUMNS} FROM room_questions WHERE room_id = $1 AND index = $2`, [roomId, questionIndex]);
  const question = readRoomQuestion(questionRow.rows[0] as RoomQuestionRow);
  const seats = await tx.query<SeatRow>("SELECT id, score, streak, cumulative_ms, joined_at FROM seats WHERE room_id = $1 ORDER BY join_seq", [roomId]);
  const answers = await tx.query<AnswerRow>("SELECT seat_id, latency_ms, given FROM answers WHERE room_id = $1 AND question_index = $2", [roomId, questionIndex]);
  const answerBySeat = new Map(answers.rows.map((row) => [row.seat_id, row]));
  const scored = scoredQuestion(question);

  const settled: Settled[] = seats.rows.map((seat) => {
    const answer = answerBySeat.get(seat.id);
    const given = answer ? givenSchema.parse(answer.given) : null;
    const result = scoreAnswer(scored, given, answer?.latency_ms ?? 0, question.timeLimitMs, seat.streak);
    return { seatId: seat.id, ...result, given, latencyMs: answer?.latency_ms ?? null };
  });

  const bySeat = new Map(seats.rows.map((seat) => [seat.id, seat]));
  const opensAt = question.opensAt as number;
  await tx.query(
    `UPDATE seats SET score = seats.score + t.points, streak = t.streak, cumulative_ms = seats.cumulative_ms + t.elapsed
     FROM unnest($2::uuid[], $3::int[], $4::int[], $5::bigint[]) AS t(id, points, streak, elapsed)
     WHERE seats.id = t.id AND seats.room_id = $1`,
    [
      roomId,
      settled.map((s) => s.seatId),
      settled.map((s) => s.points),
      settled.map((s) => s.streak),
      // Response time counts the latency, or the full window for a seat that was seated when the question opened and did not answer.
      settled.map((s) => s.latencyMs ?? (Number(bySeat.get(s.seatId)?.joined_at) <= opensAt ? question.timeLimitMs : 0)),
    ],
  );
  await tx.query(
    `UPDATE answers SET points = t.points FROM unnest($2::uuid[], $3::int[]) AS t(seat_id, points)
     WHERE answers.room_id = $1 AND answers.question_index = $4 AND answers.seat_id = t.seat_id`,
    [roomId, settled.filter((s) => s.given).map((s) => s.seatId), settled.filter((s) => s.given).map((s) => s.points), questionIndex],
  );

  const standings = await rewriteStandings(tx, roomId);
  const reveal = numbers(question, settled, answers.rowCount ?? 0, seats.rowCount ?? 0);
  await tx.query("UPDATE room_questions SET reveal = $3 WHERE room_id = $1 AND index = $2", [roomId, questionIndex, JSON.stringify(reveal)]);
  return { reveal, standings, scores: standings.map(({ seatId, score }) => ({ seatId, score })) };
}
