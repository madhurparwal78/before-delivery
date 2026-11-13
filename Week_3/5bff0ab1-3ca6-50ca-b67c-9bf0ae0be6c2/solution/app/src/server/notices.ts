import { randomUUID } from "node:crypto";
import { hubName, modelName, type HubId, type ModelId } from "../shared/catalogue.js";
import { addDays, isoIst, istDate, istInstant, realNow, shortDate, timeLabel, timeOf } from "../shared/clock.js";
import type { Notice } from "../shared/types.js";
import { now } from "./core.js";
import { q, tx, type Db } from "./db.js";
import { publishNotice, topicOf } from "./providers.js";

/** Phone notices: a record appears with the event, is sent once at its due time, and is cancelled when its event ends. */

type NoticeRow = { id: string; kind: Notice["kind"]; state: Notice["state"]; due_ms: number; sent_ms: number | null; lock_id: string | null; ride_id: string | null; rider_id: string };

export const serializeNotice = (n: NoticeRow): Notice => ({
  id: n.id,
  kind: n.kind,
  state: n.state,
  dueAt: isoIst(n.due_ms),
  sentAt: n.sent_ms === null ? null : isoIst(n.sent_ms),
  lockId: n.lock_id,
  rideId: n.ride_id,
});

export const noticesOf = (riderId: string): Promise<NoticeRow[]> => q<NoticeRow>("SELECT * FROM notices WHERE rider_id=$1 ORDER BY n", [riderId]);
export const noticeById = async (id: string, riderId: string): Promise<NoticeRow | null> => (await q<NoticeRow>("SELECT * FROM notices WHERE id=$1 AND rider_id=$2", [id, riderId]))[0] ?? null;

const LOCK_ENDING_AT = "12:00";
const RIDE_REMINDER_AT = "18:00";

export const lockEndingDue = (expiresMs: number): number => istInstant(istDate(expiresMs), LOCK_ENDING_AT);
export const rideReminderDue = (startMs: number): number => istInstant(addDays(istDate(startMs), -1), RIDE_REMINDER_AT);

export async function addNotice(c: Db, kind: Notice["kind"], riderId: string, ref: { lockId?: string; rideId?: string }, dueMs: number): Promise<void> {
  await q("INSERT INTO notices (id, kind, rider_id, lock_id, ride_id, due_ms) VALUES ($1,$2,$3,$4,$5,$6)", [randomUUID(), kind, riderId, ref.lockId ?? null, ref.rideId ?? null, dueMs], c);
}

export const cancelLockNotices = (c: Db, lockId: string): Promise<unknown> => q("UPDATE notices SET state='cancelled' WHERE lock_id=$1 AND state='pending'", [lockId], c);
export const cancelRideNotices = (c: Db, rideId: string): Promise<unknown> => q("UPDATE notices SET state='cancelled' WHERE ride_id=$1 AND state='pending'", [rideId], c);

type DueRow = NoticeRow & { reminders_on: boolean; lock_state: string | null; lock_hub: HubId | null; lock_model: ModelId | null; lock_expires: number | null; lock_delivery: string | null; ride_state: string | null; ride_hub: HubId | null; ride_model: ModelId | null; ride_start: number | null };

function messageOf(n: DueRow): { title: string; message: string } {
  if (n.kind === "lock_ending") {
    return { title: "Price lock ends today", message: `Your ${modelName(n.lock_model as string)} price lock at ${hubName(n.lock_hub as string)} ends at ${timeOf(n.lock_expires as number)} IST today.` };
  }
  if (n.kind === "ride_reminder") {
    return { title: "Test ride tomorrow", message: `Your ${modelName(n.ride_model as string)} ride at ${hubName(n.ride_hub as string)} is tomorrow at ${timeLabel(n.ride_start as number)}.` };
  }
  return { title: "Delivery day set", message: `A place opened at ${hubName(n.lock_hub as string)}. Your ${modelName(n.lock_model as string)} handover is on ${shortDate(n.lock_delivery as string)}.` };
}

const stillWanted = (n: DueRow): boolean =>
  n.kind === "lock_ending" ? n.lock_state === "locked" : n.kind === "ride_reminder" ? n.ride_state === "booked" : n.lock_state === "delivery_set";

const retryAfter = new Map<string, number>();

/** Sends what is due. A notice another copy is working on is skipped, and one that fails stays pending for the next sweep. */
export async function sendDueNotices(): Promise<void> {
  const at = await now();
  const ids = await q<{ id: string }>("SELECT id FROM notices WHERE state='pending' AND due_ms <= $1 ORDER BY due_ms LIMIT 25", [at]);
  for (const { id } of ids) {
    if ((retryAfter.get(id) ?? 0) > realNow()) continue;
    await tx(async (c) => {
      const row = (
        await q<DueRow>(
          `SELECT n.*, u.reminders_on, l.state AS lock_state, l.hub AS lock_hub, l.model AS lock_model, l.expires_ms AS lock_expires, l.delivery_date AS lock_delivery,
                  r.state AS ride_state, r.hub AS ride_hub, r.model AS ride_model, r.starts_ms AS ride_start
           FROM notices n JOIN users u ON u.id = n.rider_id LEFT JOIN locks l ON l.id = n.lock_id LEFT JOIN rides r ON r.id = n.ride_id
           WHERE n.id = $1 AND n.state = 'pending' FOR UPDATE OF n SKIP LOCKED`,
          [id],
          c,
        )
      )[0];
      if (!row) return;
      if (!row.reminders_on || !stillWanted(row)) {
        await q("UPDATE notices SET state='cancelled' WHERE id=$1", [id], c);
        return;
      }
      const { title, message } = messageOf(row);
      if (await publishNotice(topicOf(row.rider_id), title, message)) {
        await q("UPDATE notices SET state='sent', sent_ms=$2 WHERE id=$1", [id, at], c);
        retryAfter.delete(id);
      } else {
        retryAfter.set(id, realNow() + 2000);
      }
    });
  }
}
