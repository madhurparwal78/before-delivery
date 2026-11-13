import { config } from "../config.js";
import { windowOpen } from "../answerWindow.js";
import { nowMs } from "../clock.js";
import { pool } from "../db.js";
import { connectedClientCount } from "../presence.js";
import { forgetPresence, presenceMayHaveChanged } from "./presenceEvents.js";

const DEADLINE_SWEEP_MS = 1000;
const WATCH_SWEEP_MS = 500;

type Hooks = {
  lockAtDeadline: (roomId: string, questionIndex: number) => Promise<void>;
  endWhenIdle: (roomId: string) => Promise<void>;
};

// Rooms this process watches: the moment each last had no connected client (null while someone is connected).
const watched = new Map<string, { emptySince: number | null }>();
const questionTimers = new Map<string, NodeJS.Timeout>();
let hooks: Hooks | null = null;

export function watchRoom(roomId: string): void {
  watched.set(roomId, { emptySince: nowMs() });
}

export function watchEnded(roomId: string): void {
  watched.delete(roomId);
  forgetPresence(roomId);
  clearTimeout(questionTimers.get(roomId));
  questionTimers.delete(roomId);
}

export function watchQuestion(roomId: string, questionIndex: number, deadlineAt: number): void {
  clearTimeout(questionTimers.get(roomId));
  const timer = setTimeout(() => void runLock(roomId, questionIndex), Math.max(0, deadlineAt - nowMs()) + 5);
  timer.unref();
  questionTimers.set(roomId, timer);
}

async function runLock(roomId: string, questionIndex: number): Promise<void> {
  try {
    await hooks?.lockAtDeadline(roomId, questionIndex);
  } catch (error) {
    console.error("auto-lock:", error instanceof Error ? error.message : error);
  }
}

async function sweepDeadlines(): Promise<void> {
  const open = await pool.query<{ id: string; question_index: number; deadline_at: string }>(
    `SELECT r.id, r.question_index, q.deadline_at FROM rooms r JOIN room_questions q ON q.room_id = r.id AND q.index = r.question_index
     WHERE r.state = 'question_open'`,
  );
  const now = nowMs();
  for (const room of open.rows) if (!windowOpen(Number(room.deadline_at), now)) await runLock(room.id, room.question_index);
}

async function sweepWatched(): Promise<void> {
  const now = nowMs();
  for (const [roomId, watch] of watched) {
    presenceMayHaveChanged(roomId);
    if (connectedClientCount(roomId) > 0) {
      watch.emptySince = null;
    } else if (watch.emptySince === null) {
      watch.emptySince = now;
    } else if (now - watch.emptySince >= config.roomIdleSeconds * 1000) {
      watched.delete(roomId);
      await hooks?.endWhenIdle(roomId).catch((error: unknown) => console.error("idle end:", error instanceof Error ? error.message : error));
    }
  }
}

function every(ms: number, work: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    work()
      .catch((error: unknown) => console.error("timer sweep:", error instanceof Error ? error.message : error))
      .finally(() => {
        running = false;
      });
  }, ms).unref();
}

// Rooms left open by a previous run are watched again, and open questions get their lock timer back.
export async function startTimers(callbacks: Hooks): Promise<void> {
  hooks = callbacks;
  const unended = await pool.query<{ id: string }>("SELECT id FROM rooms WHERE state <> 'ended'");
  for (const room of unended.rows) watchRoom(room.id);
  const asking = await pool.query<{ id: string; question_index: number; deadline_at: string }>(
    `SELECT r.id, r.question_index, q.deadline_at FROM rooms r JOIN room_questions q ON q.room_id = r.id AND q.index = r.question_index
     WHERE r.state = 'question_open'`,
  );
  for (const room of asking.rows) watchQuestion(room.id, room.question_index, Number(room.deadline_at));
  every(DEADLINE_SWEEP_MS, sweepDeadlines);
  every(WATCH_SWEEP_MS, sweepWatched);
}
