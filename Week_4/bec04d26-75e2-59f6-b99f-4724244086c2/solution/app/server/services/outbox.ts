import { actionId } from "../cause";
import { transaction } from "../db";
import { bookkeeperOf, getPractice, nowOf } from "../store/practice";
import { loadView } from "../store/returns";
import { toIso } from "../domain/labels";
import type { Lead } from "../domain/reminders";
import type { ReturnView } from "../../shared/types";
import { publish } from "./hub";
import { reminderMessage } from "./messages";
import { sendMail } from "./smtp";
import { markReachable } from "./status";

type Outcome = "sent" | "none" | "failed";
type Sent = { outcome: Outcome; event?: { practiceId: string; view: ReturnView } };

/** Sends the oldest pending notice; it counts as sent only once the mail server has accepted it. */
async function sendNextNotice(practiceId: string | null): Promise<Outcome> {
  return transaction(async (db): Promise<Outcome> => {
    const { rows: [notice] } = await db.query<{ id: number; to_email: string; subject: string; body: string }>(
      `SELECT id, to_email, subject, body FROM notices WHERE status = 'pending' AND ($1::uuid IS NULL OR practice_id = $1)
       ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`, [practiceId]);
    if (!notice) return "none";
    try {
      await sendMail({ to: notice.to_email, subject: notice.subject, body: notice.body });
    } catch {
      markReachable("mail", false);
      return "failed";
    }
    await db.query("UPDATE notices SET status = 'sent', sent_at = now() WHERE id = $1", [notice.id]);
    return "sent";
  });
}

/** Sends the oldest reminder whose scheduled instant the practice clock has reached. */
async function sendNextReminder(practiceId: string | null): Promise<Outcome> {
  const { outcome, event } = await transaction(async (db): Promise<Sent> => {
    const { rows: [due] } = await db.query<{ return_id: string; lead_days: Lead; practice_id: string }>(
      `SELECT rm.return_id, rm.lead_days, r.practice_id
       FROM reminders rm JOIN returns r ON r.id = rm.return_id JOIN practices p ON p.id = r.practice_id
       WHERE rm.status = 'pending' AND rm.scheduled_for <= COALESCE(p.clock_now, now())
         AND ($1::uuid IS NULL OR r.practice_id = $1)
       ORDER BY rm.scheduled_for, rm.return_id LIMIT 1 FOR UPDATE OF rm SKIP LOCKED`, [practiceId]);
    if (!due) return { outcome: "none" };
    const practice = await getPractice(db, due.practice_id);
    const view = await loadView(db, due.return_id);
    const message = reminderMessage(view, due.lead_days);
    try {
      await sendMail({ to: (await bookkeeperOf(db, due.practice_id)).email, ...message });
    } catch {
      markReachable("mail", false);
      return { outcome: "failed" };
    }
    await db.query("UPDATE reminders SET status = 'sent', sent_at = $3 WHERE return_id = $1 AND lead_days = $2",
      [due.return_id, due.lead_days, toIso(nowOf(practice))]);
    return { outcome: "sent", event: { practiceId: due.practice_id, view } };
  });
  if (event) {
    publish(event.practiceId, {
      type: "reminder", return_id: event.view.id, client: event.view.client.name, state: event.view.state,
      period_label: event.view.period_label, cause: actionId.getStore() ?? null,
    }, { bookkeeperOnly: true });
  }
  return outcome;
}

let draining: Promise<void> | null = null;
let again = false;

async function drain(practiceId: string | null): Promise<void> {
  do {
    again = false;
    for (const next of [sendNextNotice, sendNextReminder]) {
      for (let outcome = await next(practiceId); outcome !== "none"; outcome = await next(practiceId)) {
        if (outcome === "failed") return;
      }
    }
  } while (again && !practiceId);
}

/**
 * Sends what is waiting: one practice's own work when a request asks, otherwise everything. It stops at the first
 * refusal and leaves the rest pending for the next retry. Concurrent drains take different rows (`SKIP LOCKED`).
 */
export function dispatchMail(practiceId: string | null = null): Promise<void> {
  if (practiceId) return drain(practiceId);
  if (draining) {
    again = true;
    return draining;
  }
  draining = drain(null).finally(() => { draining = null; });
  return draining;
}
