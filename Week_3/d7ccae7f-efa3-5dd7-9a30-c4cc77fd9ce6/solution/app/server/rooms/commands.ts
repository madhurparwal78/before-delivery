import type { HostCommand, RoomState, StoredEvent } from "../../shared/schemas.js";
import { windowOpen } from "../answerWindow.js";
import { nowMs } from "../clock.js";
import { transaction, type Tx } from "../db.js";
import { apiError, notFound } from "../errors.js";
import { expireRoomKeys, writeScores } from "../live/valkey.js";
import { forgetRoom } from "../presence.js";
import { appendEvent, announce } from "./events.js";
import { resolveCommand, resolveIdleEnd, type Verdict } from "../../shared/machine.js";
import { settleQuestion } from "./reveal.js";
import { ROOM_QUESTION_COLUMNS, playerQuestion, readRoomQuestion, type RoomQuestionRow } from "./snapshot.js";
import { readStandings } from "./standings.js";
import { watchEnded, watchQuestion } from "./timers.js";

type Actor = "host" | "deadline" | "idle";
type LockedRoom = { id: string; state: RoomState; question_index: number | null; question_count: number };
type Applied = { events: StoredEvent[]; afterCommit: (() => Promise<void>)[] };
type Plan = { command: HostCommand; to: RoomState };

async function lockRoom(tx: Tx, roomId: string): Promise<LockedRoom | null> {
  const result = await tx.query<LockedRoom>("SELECT id, state, question_index, question_count FROM rooms WHERE id = $1 FOR UPDATE", [roomId]);
  return result.rows[0] ?? null;
}

async function recordTransition(tx: Tx, room: LockedRoom, plan: Plan, actor: Actor, questionIndex: number | null): Promise<void> {
  await tx.query(
    "INSERT INTO room_transitions (room_id, command, from_state, to_state, question_index, actor, at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [room.id, plan.command, room.state, plan.to, questionIndex, actor, nowMs()],
  );
}

async function openQuestion(tx: Tx, room: LockedRoom, plan: Plan, actor: Actor): Promise<Applied> {
  const index = (room.question_index ?? 0) + 1;
  const opensAt = nowMs();
  const opened = await tx.query<RoomQuestionRow>(
    `UPDATE room_questions SET opens_at = $3::bigint, deadline_at = $3::bigint + time_limit_ms WHERE room_id = $1 AND index = $2 RETURNING ${ROOM_QUESTION_COLUMNS}`,
    [room.id, index, opensAt],
  );
  const question = readRoomQuestion(opened.rows[0] as RoomQuestionRow);
  await tx.query("UPDATE rooms SET state = $3, question_index = $2 WHERE id = $1", [room.id, index, plan.to]);
  await recordTransition(tx, room, plan, actor, index);
  const event = await appendEvent(tx, room.id, { type: "question_open", data: playerQuestion(question) });
  return { events: [event], afterCommit: [async () => watchQuestion(room.id, index, question.deadlineAt as number)] };
}

async function lockQuestion(tx: Tx, room: LockedRoom, plan: Plan, actor: Actor): Promise<Applied> {
  await tx.query("UPDATE rooms SET state = $2 WHERE id = $1", [room.id, plan.to]);
  await recordTransition(tx, room, plan, actor, room.question_index);
  const event = await appendEvent(tx, room.id, { type: "locked", data: { questionIndex: room.question_index as number, reason: actor === "deadline" ? "deadline" : "host" } });
  return { events: [event], afterCommit: [] };
}

async function revealQuestion(tx: Tx, room: LockedRoom, plan: Plan, actor: Actor): Promise<Applied> {
  const settled = await settleQuestion(tx, room.id, room.question_index as number);
  await tx.query("UPDATE rooms SET state = $2 WHERE id = $1", [room.id, plan.to]);
  await recordTransition(tx, room, plan, actor, room.question_index);
  const event = await appendEvent(tx, room.id, { type: "reveal", data: settled.reveal });
  return { events: [event], afterCommit: [() => writeScores(room.id, settled.scores)] };
}

async function showLeaderboard(tx: Tx, room: LockedRoom, plan: Plan, actor: Actor): Promise<Applied> {
  await tx.query("UPDATE rooms SET state = $2 WHERE id = $1", [room.id, plan.to]);
  await recordTransition(tx, room, plan, actor, room.question_index);
  const event = await appendEvent(tx, room.id, { type: "leaderboard", data: { standings: await readStandings(tx, room.id) } });
  return { events: [event], afterCommit: [] };
}

async function showPodium(tx: Tx, room: LockedRoom, plan: Plan, actor: Actor): Promise<Applied> {
  await tx.query("UPDATE rooms SET state = $2 WHERE id = $1", [room.id, plan.to]);
  await recordTransition(tx, room, plan, actor, room.question_index);
  const standings = await readStandings(tx, room.id);
  const event = await appendEvent(tx, room.id, { type: "podium", data: { top: standings.slice(0, 3), standings } });
  return { events: [event], afterCommit: [] };
}

async function endRoom(tx: Tx, room: LockedRoom, plan: Plan, actor: Actor): Promise<Applied> {
  const reason = actor === "idle" ? "idle" : "host";
  const event = await appendEvent(tx, room.id, { type: "ended", data: { reason } });
  await tx.query("UPDATE rooms SET state = $4, ended_at = $2, end_reason = $3 WHERE id = $1", [room.id, nowMs(), reason, plan.to]);
  await recordTransition(tx, room, plan, actor, room.question_index);
  return {
    events: [event],
    afterCommit: [
      async () => {
        watchEnded(room.id);
        forgetRoom(room.id);
        await expireRoomKeys(room.id);
      },
    ],
  };
}

const steps: Record<HostCommand, (tx: Tx, room: LockedRoom, plan: Plan, actor: Actor) => Promise<Applied>> = {
  open_question: openQuestion,
  lock: lockQuestion,
  reveal: revealQuestion,
  show_leaderboard: showLeaderboard,
  show_podium: showPodium,
  end: endRoom,
};

async function finish(roomId: string, applied: Applied): Promise<void> {
  await announce(roomId, applied.events);
  for (const run of applied.afterCommit) await run();
}

function refuse(verdict: Extract<Verdict, { ok: false }>, state: RoomState, command: HostCommand): never {
  throw verdict.refusal === "illegal_transition" ? apiError(409, "illegal_transition", { state, command }) : apiError(409, verdict.refusal);
}

// A host command: of several simultaneous identical commands the row lock lets exactly one through.
export async function runHostCommand(roomId: string, command: HostCommand): Promise<void> {
  const applied = await transaction(async (tx) => {
    const room = await lockRoom(tx, roomId);
    if (!room) throw notFound();
    const verdict = resolveCommand(room.state, command, room.question_index, room.question_count);
    if (!verdict.ok) refuse(verdict, room.state, command);
    return steps[command](tx, room, { command, to: verdict.to }, "host");
  });
  await finish(roomId, applied);
}

// The server locks a question that is still open once its deadline has passed.
export async function lockAtDeadline(roomId: string, questionIndex: number): Promise<void> {
  const applied = await transaction(async (tx) => {
    const room = await lockRoom(tx, roomId);
    const verdict = room && room.question_index === questionIndex ? resolveCommand(room.state, "lock", room.question_index, room.question_count) : null;
    if (!room || !verdict?.ok) return null;
    const row = await tx.query<{ deadline_at: string }>("SELECT deadline_at FROM room_questions WHERE room_id = $1 AND index = $2", [roomId, questionIndex]);
    return windowOpen(Number(row.rows[0]?.deadline_at), nowMs()) ? null : lockQuestion(tx, room, { command: "lock", to: verdict.to }, "deadline");
  });
  if (applied) await finish(roomId, applied);
}

export async function endWhenIdle(roomId: string): Promise<void> {
  const applied = await transaction(async (tx) => {
    const room = await lockRoom(tx, roomId);
    const verdict = room ? resolveIdleEnd(room.state) : null;
    return room && verdict?.ok ? endRoom(tx, room, { command: "end", to: verdict.to }, "idle") : null;
  });
  if (applied) await finish(roomId, applied);
}
