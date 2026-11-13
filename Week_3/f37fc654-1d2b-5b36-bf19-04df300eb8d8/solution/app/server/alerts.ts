// Crew alerts on the ntfy topic (brief: Services › ntfy, Business rules › Crew alerts).
import { randomUUID } from "node:crypto";
import { formatDay } from "../shared/format.js";
import { loadCommission, type Commission } from "./commissions.js";
import { query, type Db } from "./db.js";
import { enqueue } from "./jobs.js";

type AlertKind = "slot_confirmed" | "load_in" | "placement_changed";

export function crewAlertTitle(kind: AlertKind, c: Commission, date: string): string {
  if (kind === "slot_confirmed") return `Slot confirmed — ${c.venue.name} — ${formatDay(date)}`;
  if (kind === "load_in") return `Load-in tomorrow — ${c.venue.name} — ${formatDay(date)}`;
  return `Placement changed — ${c.title}`;
}

/** Queues one alert; the body carries the job id as its reference. */
export async function queueCrewAlert(db: Db, c: Commission, installDayId: string, date: string, kind: AlertKind): Promise<void> {
  const id = randomUUID();
  await enqueue(db, "crew_alert", c.id, {
    title: crewAlertTitle(kind, c, date),
    message: `${c.title} at ${c.venue.name} on ${formatDay(date)}. Ref ${id}.`,
    installDayId,
    alertKind: kind,
  }, id);
}

/**
 * Queues the day-before load-in alert of every booked day whose `load_in_at` (09:00 venue time the day
 * before, recorded at booking) has come, once, in the transaction that marks it queued.
 */
export async function queueDueLoadInAlerts(db: Db, now: number): Promise<void> {
  const due = await query<{ id: string; commission_id: string; date: string }>(
    `UPDATE install_days SET load_in_queued_at = $1
      WHERE id IN (SELECT id FROM install_days WHERE load_in_queued_at IS NULL AND released_at IS NULL AND load_in_at <= $1 FOR UPDATE SKIP LOCKED)
      RETURNING id, commission_id, date`, [new Date(now)], db,
  );
  for (const day of due) {
    const c = await loadCommission(db, day.commission_id);
    if (c) await queueCrewAlert(db, c, day.id, day.date, "load_in");
  }
}
