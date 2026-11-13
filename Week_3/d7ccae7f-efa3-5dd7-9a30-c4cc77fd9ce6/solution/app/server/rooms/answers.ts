import { z } from "zod";
import { measureWindow, windowOpen } from "../answerWindow.js";
import { nowMs } from "../clock.js";
import { transaction } from "../db.js";
import { apiError, validationFailed } from "../errors.js";
import { announce, appendEvent } from "./events.js";
import { resolveClient } from "./clients.js";
import { ROOM_QUESTION_COLUMNS, readRoomQuestion, type RoomQuestion, type RoomQuestionRow } from "./snapshot.js";
import { acceptsAnswers } from "../../shared/machine.js";
import type { RoomState } from "../../shared/schemas.js";
import type { Given } from "../scoring.js";

const envelope = z.looseObject({ clientId: z.string(), questionIndex: z.number().int() });

type Receipt = { questionIndex: number; latencyMs: number; remainingMs: number };

// An answer needs the current question, open at its deadline; a later or post-lock one is refused with the server's remaining milliseconds.
function checkWindow(state: RoomState, current: number | null, question: RoomQuestion | null, asked: number, receivedAt: number): { latencyMs: number; remainingMs: number } {
  if (!question || current !== asked || !acceptsAnswers(state)) {
    throw apiError(409, "question_not_open", { state });
  }
  const timing = measureWindow(question.opensAt as number, question.deadlineAt as number, receivedAt);
  if (state === "locked" || !windowOpen(question.deadlineAt as number, receivedAt)) throw apiError(409, "window_closed", { remainingMs: timing.remainingMs });
  return timing;
}

function parseGiven(question: RoomQuestion, body: Record<string, unknown>): Given {
  const supplied = ["choice", "estimate", "order"].filter((name) => body[name] !== undefined);
  const wrong = (field: string, message: string) => validationFailed({ [field]: message });
  switch (question.type) {
    case "multiple_choice": {
      const choice = body["choice"];
      if (supplied.length !== 1 || typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= question.options.length) {
        throw wrong("choice", "Choose one of the options");
      }
      return { choice };
    }
    case "estimate": {
      const estimate = body["estimate"];
      if (supplied.length !== 1 || typeof estimate !== "number" || !Number.isFinite(estimate) || estimate < question.min || estimate > question.max) {
        throw wrong("estimate", "Give a number between the minimum and maximum");
      }
      return { estimate };
    }
    case "sequence": {
      const order = z.array(z.string()).safeParse(body["order"]);
      const ids = question.items.map((item) => item.id);
      if (supplied.length !== 1 || !order.success || order.data.length !== ids.length || new Set(order.data).size !== ids.length || !order.data.every((id) => ids.includes(id))) {
        throw wrong("order", "Put every item in an order");
      }
      return { order: order.data };
    }
  }
}

export async function recordAnswer(roomId: string, body: unknown): Promise<Receipt> {
  const receivedAt = nowMs();
  const parsed = envelope.safeParse(body);
  if (!parsed.success) throw validationFailed({ [String(parsed.error.issues[0]?.path[0] ?? "clientId")]: "Required" });
  const client = await resolveClient(parsed.data.clientId, roomId);
  const asked = parsed.data.questionIndex;
  const recorded = await transaction(async (tx) => {
    const room = await tx.query<{ state: RoomState; question_index: number | null }>("SELECT state, question_index FROM rooms WHERE id = $1 FOR UPDATE", [roomId]);
    const { state, question_index: current } = room.rows[0] as { state: RoomState; question_index: number | null };
    const row = await tx.query<RoomQuestionRow>(`SELECT ${ROOM_QUESTION_COLUMNS} FROM room_questions WHERE room_id = $1 AND index = $2`, [roomId, current ?? 0]);
    const question = row.rows[0] ? readRoomQuestion(row.rows[0]) : null;
    const timing = checkWindow(state, current, question, asked, receivedAt);
    const existing = await tx.query("SELECT 1 FROM answers WHERE room_id = $1 AND seat_id = $2 AND question_index = $3", [roomId, client.seatId, asked]);
    if (existing.rowCount) throw apiError(409, "already_answered");
    const given = parseGiven(question as RoomQuestion, parsed.data);
    await tx.query(
      "INSERT INTO answers (room_id, seat_id, question_index, latency_ms, received_at, given) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6)",
      [roomId, client.seatId, asked, timing.latencyMs, receivedAt, JSON.stringify(given)],
    );
    const counts = await tx.query<{ answered: number; seated: number }>(
      `SELECT (SELECT count(*)::int FROM answers WHERE room_id = $1 AND question_index = $2) AS answered,
              (SELECT count(*)::int FROM seats WHERE room_id = $1) AS seated`,
      [roomId, asked],
    );
    const { answered, seated } = counts.rows[0] as { answered: number; seated: number };
    const event = await appendEvent(tx, roomId, { type: "answer_count", data: { questionIndex: asked, answered, seated } });
    return { timing, event };
  });
  await announce(roomId, [recorded.event]);
  return { questionIndex: asked, ...recorded.timing };
}
