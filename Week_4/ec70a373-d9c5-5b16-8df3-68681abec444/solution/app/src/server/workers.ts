// Background work every server process runs: mail delivery, hold and lot expiry, and the expiry-notice scan.
import { pool, rows, tx } from "./db.ts";
import { now } from "./clock.ts";
import { deliverOutbox, enqueueMail } from "./outbox.ts";
import { membersToSettle, settleIfFree } from "./ledger.ts";
import { validThrough } from "./coverage.ts";
import { expiryNoticeMail, type NoticeKind } from "./emails.ts";
import { daysBetween, wallClock } from "../shared/time.ts";
import type { DocumentType } from "../shared/api.ts";

const NOTICE_TYPES: DocumentType[] = ["certificate_of_insurance", "food_handler_certificate", "business_licence"];

/** Brings every member with a live hold or dated lot up to the server clock (hold and lot expiry). */
async function sweepExpiries(): Promise<void> {
  for (const memberId of await membersToSettle(pool)) await tx((db) => settleIfFree(db, memberId, now()));
}

/** Which notice is due with `daysLeft` days to go, if any. */
function noticeDue(daysLeft: number): NoticeKind | null {
  if (daysLeft >= 4 && daysLeft <= 14) return "14-day";
  if (daysLeft >= 0 && daysLeft <= 3) return "3-day";
  return null;
}

/** At most one 14-day and one 3-day notice per member, type and valid-through date, on the home site's calendar. */
async function scanNotices(): Promise<void> {
  const members = await rows<{ id: string; email: string; time_zone: string }>(
    pool,
    "SELECT m.id, u.email, s.time_zone FROM members m JOIN users u ON u.id = m.user_id JOIN sites s ON s.id = m.home_site_id",
  );
  for (const member of members) {
    const today = wallClock(now(), member.time_zone).date;
    await tx(async (db) => {
      const coverage = await validThrough(db, member.id);
      for (const type of NOTICE_TYPES) {
        const date = coverage[type];
        if (date === null) continue;
        const notice = noticeDue(daysBetween(today, date));
        if (notice === null) continue;
        const inserted = await db.query(
          "INSERT INTO notices (member_id, doc_type, valid_through, notice) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
          [member.id, type, date, notice],
        );
        if (inserted.rowCount === 1) await enqueueMail(db, expiryNoticeMail(member.email, type, date, notice));
      }
    });
  }
}

function every(ms: number, work: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    work()
      .catch((error: unknown) => console.error("background work failed:", error instanceof Error ? error.message : error))
      .finally(() => {
        running = false;
      });
  }, ms);
}

export function startWorkers(): void {
  every(1000, deliverOutbox);
  every(1000, sweepExpiries);
  every(10_000, scanNotices);
}
