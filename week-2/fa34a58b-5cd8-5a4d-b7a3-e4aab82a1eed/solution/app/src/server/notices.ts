// The notice outbox: every household notice is written here first, then sent by email exactly once.
// Schedule-change notice timing and notice delivery are decided here and nowhere else.

import { longDate } from "../shared/zone.ts";
import type { Notice, NoticeKind } from "../shared/types.ts";
import { pool, rows, transaction, type Queryable } from "./db.ts";
import { hubNow } from "./clock.ts";
import { sendMail } from "./mail.ts";
import { householdZone, type Calendar } from "./plan.ts";
import { broadcast } from "./socket.ts";
import { reportService } from "./status.ts";
import { randomUUID } from "node:crypto";

const RETRY_SECONDS = 5;
const EFFECT_HOUR = 5;

export interface NoticeRow {
  id: string;
  kind: NoticeKind;
  subject: string;
  body: string;
  to_address: string;
  state: "queued" | "sent";
  attempts: number;
  created_at: Date;
  sent_at: Date | null;
}

const COLUMNS = "id, kind, subject, body, to_address, state, attempts, created_at, sent_at";

async function toNotice(row: NoticeRow): Promise<Notice> {
  const zone = await householdZone();
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    to: row.to_address,
    state: row.state,
    attempts: row.attempts,
    created_at: zone.iso(row.created_at.getTime()),
    sent_at: row.sent_at ? zone.iso(row.sent_at.getTime()) : null,
  };
}

export async function listNotices(): Promise<Notice[]> {
  return Promise.all((await rows<NoticeRow>(pool, `SELECT ${COLUMNS} FROM notices ORDER BY position DESC`)).map(toNotice));
}

/** A notice written inside a caller's transaction; announce() it once that transaction commits. */
export interface Queued {
  row: NoticeRow;
}

/** Writes a notice to the outbox once per dedupe key; null when that notice already exists. */
async function writeNotice(db: Queryable, kind: NoticeKind, dedupeKey: string, subject: string, body: string): Promise<Queued | null> {
  const [household] = await rows<{ notice_address: string }>(db, "SELECT notice_address FROM household");
  const [row] = await rows<NoticeRow>(
    db,
    `INSERT INTO notices (id, kind, subject, body, to_address, state, created_at, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7) ON CONFLICT (dedupe_key) DO NOTHING RETURNING ${COLUMNS}`,
    [randomUUID(), kind, subject, body, (household as { notice_address: string }).notice_address, new Date(hubNow()), dedupeKey],
  );
  return row ? { row } : null;
}

/** After the outbox row is committed: push it on the socket and wake the sender. */
export async function announce(queued: (Queued | null)[]): Promise<void> {
  for (const item of queued) if (item) broadcast({ type: "notice", notice: await toNotice(item.row) });
  if (queued.some(Boolean)) wakeSender(true);
}

export async function writeGuestEnded(
  db: Queryable, guestId: string, room: string, scene: string, endsAt: number, backOn: string,
): Promise<Queued | null> {
  const zone = await householdZone(db);
  return writeNotice(
    db, "guest_scene_ended", `guest_scene_ended:${guestId}`, `Guest scene ended: ${room}`,
    `The guest scene ${scene} in ${room} ended at ${zone.clock(endsAt)} on ${longDate(zone.day(endsAt))}. ${room} is back on ${backOn}.`,
  );
}

export async function writeMotion(db: Queryable, clipId: string, camera: string, recordedAt: number, storedSize: number): Promise<Queued | null> {
  const zone = await householdZone(db);
  return writeNotice(
    db, "motion", `motion:${clipId}`, `Motion on ${camera}`,
    `${camera} recorded motion at ${zone.clockSeconds(recordedAt)} on ${longDate(zone.day(recordedAt))}. The clip is stored on the hub (${storedSize} bytes).`,
  );
}

/** A version's effect instant: 05:00:00 household time on its from date. */
const effectInstant = (calendar: Calendar, from: string): number => calendar.zone.occurrence(from, EFFECT_HOUR, 0);

/** The running clock went from `after` to `now`: effect instants it reached queue their notice. */
export const queueScheduleChangesReached = (calendar: Calendar, after: number, now: number): Promise<void> =>
  queueScheduleChanges(calendar, after, now, null);

/** A clock move landed at `now`: every effect instant at or before it, not yet noticed, queues (in from order). */
export const queueScheduleChangesJumped = (calendar: Calendar, now: number): Promise<void> =>
  queueScheduleChanges(calendar, null, now, null);

/** A save on its from date at or after the effect instant queues that version's notice at once. */
export const queueScheduleChangeSaved = (calendar: Calendar, scheduleId: string, from: string, now: number): Promise<void> =>
  queueScheduleChanges(calendar, null, now, { scheduleId, from });

/**
 * Queues one schedule-change notice per schedule and from date whose effect instant lies in
 * (after, upTo]; after = null means any time up to upTo. Each notice lists the version's slots as they
 * stand now; the seeded versions never queue one.
 */
async function queueScheduleChanges(
  calendar: Calendar,
  after: number | null,
  upTo: number,
  only: { scheduleId: string; from: string } | null,
): Promise<void> {
  const due = calendar.schedules
    .flatMap((schedule) => schedule.versions.map((version) => ({ schedule, version })))
    .filter(({ schedule, version }) => !version.seeded && (!only || (only.scheduleId === schedule.id && only.from === version.from)))
    .filter(({ version }) => {
      const effect = effectInstant(calendar, version.from);
      return effect <= upTo && (after === null || effect > after);
    })
    .sort((a, b) => a.version.from.localeCompare(b.version.from));
  const roomName = new Map(calendar.rooms.map((room) => [room.id, room.name]));
  const roomOrder = new Map(calendar.rooms.map((room) => [room.id, room.position]));
  for (const { schedule, version } of due) {
    const lines = version.slots.map((slot) => {
      const rooms = [...slot.room_ids].sort((a, b) => (roomOrder.get(a) ?? 0) - (roomOrder.get(b) ?? 0));
      return `${slot.time} ${calendar.scenes.get(slot.scene_id) ?? slot.scene_id} — ${rooms.map((id) => roomName.get(id) ?? id).join(", ")}`;
    });
    await announce([await writeNotice(
      pool, "schedule_change", `schedule_change:${schedule.id}:${version.from}`,
      `Schedule change takes effect: ${schedule.name}`,
      [`From ${longDate(version.from)}, the ${schedule.name} schedule runs these slots:`, ...lines].join("\n"),
    )]);
  }
}

/**
 * Claims the next queued notice after `after` (FOR UPDATE SKIP LOCKED, so one sender at a time), sends
 * it and marks it sent in the same transaction; a failed attempt only counts.
 */
async function deliverNext(after: string): Promise<{ position: string; sent: boolean } | null> {
  const outcome = await transaction(async (client) => {
    const [claimed] = await rows<NoticeRow & { position: string }>(
      client,
      `SELECT ${COLUMNS}, position FROM notices WHERE state = 'queued' AND position > $1
       ORDER BY position LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [after],
    );
    if (!claimed) return null;
    let sent = true;
    try {
      await sendMail({ noticeId: claimed.id, to: claimed.to_address, subject: claimed.subject, body: claimed.body });
    } catch {
      sent = false;
      reportService("mail", false);
    }
    const [row] = sent
      ? await rows<NoticeRow>(client,
        `UPDATE notices SET state = 'sent', sent_at = $2, attempts = attempts + 1 WHERE id = $1 RETURNING ${COLUMNS}`,
        [claimed.id, new Date(hubNow())])
      : await rows<NoticeRow>(client, `UPDATE notices SET attempts = attempts + 1 WHERE id = $1 RETURNING ${COLUMNS}`, [claimed.id]);
    return { position: claimed.position, sent, row: row as NoticeRow };
  });
  if (!outcome) return null;
  broadcast({ type: "notice", notice: await toNotice(outcome.row) });
  return { position: outcome.position, sent: outcome.sent };
}

let delivering = false;
let again = false;
let retryAfter = 0;

/**
 * One delivery pass tries each queued notice once, in queue order. When mail refused any, this hub
 * waits five seconds before the next pass; a newly queued notice tries at once.
 */
export function wakeSender(now = false): void {
  if (!now && Date.now() < retryAfter) return;
  if (delivering) {
    again = true;
    return;
  }
  delivering = true;
  void (async () => {
    try {
      do {
        again = false;
        let after = "0";
        let refused = false;
        for (let result = await deliverNext(after); result; result = await deliverNext(after)) {
          after = result.position;
          refused ||= !result.sent;
        }
        if (refused) retryAfter = Date.now() + RETRY_SECONDS * 1000;
      } while (again && Date.now() >= retryAfter);
    } catch {
      // PostgreSQL hiccup: the next pass (at most a second away) retries.
    } finally {
      delivering = false;
    }
  })();
}
