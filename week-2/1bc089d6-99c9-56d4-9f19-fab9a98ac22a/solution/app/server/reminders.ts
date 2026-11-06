import { startsAt, type RitualChoice } from "../src/shared/hour";
import { now } from "./clock";
import { transaction, withDb } from "./db";
import { reminderMail } from "./messages";
import { enqueue, flushOutbox } from "./outbox";
import { addDays, instantOf, wallAt } from "./zoned";

/** A reminder more than this late is skipped for that night; exactly this late still counts as on time. */
const LATE_LIMIT_MS = 60 * 60_000;

interface Schedule {
  bedtime: string;
  time_zone: string;
  reminders: "on" | "paused";
  /** The reminders-start moment: the latest confirmation, resume, or bedtime or time-zone edit. */
  active_since: Date;
}

/**
 * When a night's reminder is due: the hour's local start on that date, in the hour's zone. A start that
 * does not exist (clocks spring forward) moves to the first valid minute after; one that happens twice
 * (clocks fall back) is due at the first occurrence.
 */
function dueOn(night: string, schedule: Pick<Schedule, "bedtime" | "time_zone">) {
  return instantOf(night, startsAt(schedule.bedtime), schedule.time_zone);
}

/**
 * The earliest eligible night after `lastNight` (the last night with a record) and when its reminder is
 * due, or null while reminders are paused. A night is eligible when its reminder is due at or after the
 * reminders-start moment; nights are recorded in order, so every eligible night up to `lastNight` has one.
 */
function nextNight(schedule: Schedule, lastNight: string | null): { night: string; due: number } | null {
  if (schedule.reminders === "paused") return null;
  const since = schedule.active_since.getTime();
  let night = wallAt(since, schedule.time_zone).date;
  if (dueOn(night, schedule) < since) night = addDays(night, 1);
  if (lastNight && lastNight >= night) night = addDays(lastNight, 1);
  return { night, due: dueOn(night, schedule) };
}

/** `next_reminder_at`: the due time of the earliest eligible night with no record, or null while paused. */
export function nextReminder(schedule: Schedule, lastNight: string | null): number | null {
  return nextNight(schedule, lastNight)?.due ?? null;
}

interface ActivePlan extends Schedule {
  id: string;
  rituals: RitualChoice[];
  email: string;
  last_night: string | null;
}

/** Selects the last night with a reminder record for the plan aliased `p` (null before the first). */
export const LAST_NIGHT = "(SELECT to_char(max(r.night), 'YYYY-MM-DD') FROM reminders r WHERE r.plan_id = p.id) AS last_night";

const ACTIVE_PLAN = `SELECT p.id, p.bedtime, p.time_zone, p.reminders, p.active_since, p.rituals, v.email, ${LAST_NIGHT}
  FROM plans p JOIN visitors v ON v.id = p.visitor_id`;

/**
 * One scheduler run: every eligible night that is due and has no record gets exactly one, "sent" (and its
 * email written to the outbox) when the app clock is at most 60 minutes past the due time, otherwise
 * "skipped". The plan row is locked while its nights are written. The record's key is the plan and night,
 * and a second instance that waited on the lock may still have read the previous last night, so a night
 * already written is left alone rather than written twice.
 */
export async function sendDueReminders() {
  const at = now().getTime();
  const plans = await withDb((db) => db.query<ActivePlan>(ACTIVE_PLAN));
  for (const plan of plans.rows) {
    if ((nextReminder(plan, plan.last_night) ?? Infinity) > at) continue;
    await transaction(async (db) => {
      const locked = await db.query<ActivePlan>(`${ACTIVE_PLAN} WHERE p.id = $1 FOR UPDATE OF p`, [plan.id]);
      const fresh = locked.rows[0];
      if (!fresh) return;
      for (let next = nextNight(fresh, fresh.last_night); next && next.due <= at; next = nextNight(fresh, next.night)) {
        const status = at - next.due <= LATE_LIMIT_MS ? "sent" : "skipped";
        const recorded = await db.query(
          "INSERT INTO reminders (plan_id, night, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING plan_id",
          [fresh.id, next.night, status],
        );
        if (!recorded.rowCount || status === "skipped") continue;
        await enqueue(db, { to: fresh.email, ...reminderMail(fresh, wallAt(next.due, fresh.time_zone).time) });
      }
    });
  }
  await flushOutbox();
}
