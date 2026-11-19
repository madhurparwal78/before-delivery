import { pool, query, transaction } from "../db";
import { toIso } from "../domain/labels";
import { isOverdue } from "../domain/overdue";
import { UNFILED } from "../domain/status";
import { localDate, localMinuteOfDay, PRACTICE_ZONE, weekOf } from "../domain/zone";
import { getPractice, nowOf } from "../store/practice";
import { loadViews } from "../store/returns";
import { deadlineOrder } from "../../shared/order";
import type { ClockView, Status } from "../../shared/types";
import { background } from "./background";
import { practicesWithScreens, publish } from "./hub";
import { dispatchMail } from "./outbox";
import { serviceView } from "./status";

export function clockView(nowMs: number): ClockView {
  const week = weekOf(nowMs, PRACTICE_ZONE);
  return {
    now: toIso(nowMs), today: localDate(nowMs, PRACTICE_ZONE), minute: localMinuteOfDay(nowMs, PRACTICE_ZONE),
    week_start: week.start, week_end: week.end,
  };
}

/** Returns whose overdue flag differs between two instants of the practice clock, in announcement order. */
async function overdueFlips(practiceId: string, fromMs: number, toMs: number): Promise<string[]> {
  const unfiled = await query<{ id: string; status: Status; due_at: string; state: string; name: string }>(
    pool, `SELECT r.id, r.status, r.due_at, r.state_code AS state, c.name FROM returns r JOIN clients c ON c.id = r.client_id
           WHERE r.practice_id = $1 AND r.status = ANY($2)`, [practiceId, [...UNFILED]]);
  return unfiled
    .filter((r) => isOverdue(r.status, Date.parse(r.due_at), fromMs) !== isOverdue(r.status, Date.parse(r.due_at), toMs))
    .map((r) => ({ id: r.id, state: r.state, due_at: r.due_at, client: { name: r.name } }))
    .sort(deadlineOrder)
    .map((r) => r.id);
}

/** Tells every open screen of the practice that its clock moved, and which returns crossed their deadline. */
async function announceClock(practiceId: string, fromMs: number, toMs: number): Promise<void> {
  const practice = await getPractice(pool, practiceId);
  const flipped = await overdueFlips(practiceId, fromMs, toMs);
  const views = await loadViews(pool, practice, { ids: flipped });
  publish(practiceId, { type: "clock", clock: clockView(toMs) });
  for (const id of flipped) {
    const view = views.find((v) => v.id === id)!;
    publish(practiceId, { type: "return", change: view.overdue ? "overdue" : "clock", by: "", return: view },
      { clientId: view.client.id });
  }
  publish(practiceId, { type: "lists" }, { bookkeeperOnly: true });
  for (const clientId of new Set(views.map((v) => v.client.id))) publish(practiceId, { type: "lists" }, { clientId });
}

/** Freezes the practice clock at an instant; due reminders go out before this resolves. */
export async function setPracticeClock(practiceId: string, toMs: number): Promise<void> {
  const fromMs = await transaction(async (db) => {
    const before = nowOf(await getPractice(db, practiceId));
    await db.query("UPDATE practices SET clock_now = $2 WHERE id = $1", [practiceId, toIso(toMs)]);
    return before;
  });
  await dispatchMail(practiceId);
  await announceClock(practiceId, fromMs, toMs);
}

const lastSeen = new Map<string, { ms: number; minute: number }>();

/** Real-time practices have no clock request: their deadlines are noticed as time passes. */
export async function tickRealTimeClocks(): Promise<void> {
  const open = practicesWithScreens();
  for (const id of lastSeen.keys()) if (!open.has(id)) lastSeen.delete(id);
  for (const practiceId of open) {
    const practice = await getPractice(pool, practiceId);
    const now = Date.now();
    if (practice.clockNow !== null) {
      lastSeen.delete(practiceId);
      continue;
    }
    const before = lastSeen.get(practiceId) ?? { ms: now, minute: localMinuteOfDay(now, PRACTICE_ZONE) };
    lastSeen.set(practiceId, { ms: now, minute: localMinuteOfDay(now, PRACTICE_ZONE) });
    if (before.minute !== localMinuteOfDay(now, PRACTICE_ZONE) || (await overdueFlips(practiceId, before.ms, now)).length) {
      await announceClock(practiceId, before.ms, now);
    }
  }
  if (serviceView().mail) background(() => dispatchMail());
}
