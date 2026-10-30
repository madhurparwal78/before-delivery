// The four member emails, worded as the brief sets them, queued in the caller's transaction.

import { formatLocalTime } from "../../shared/calendar.js";
import { type ReceiptFigures, receiptLines } from "../../shared/copy.js";
import type { Db } from "../db.js";
import { queueEmail } from "../services/mail.js";
import { library } from "./library.js";

interface NoticeTarget {
  memberId: string;
  itemName: string;
  unitLabel: string;
}

const localTime = (instant: Date) => formatLocalTime(instant, library().calendar.timeZone);

async function emailOf(db: Db, memberId: string): Promise<string> {
  const found = await db.query<{ email: string }>("SELECT email FROM person WHERE id = $1", [memberId]);
  const email = found.rows[0]?.email;
  if (!email) throw new Error("notice for an unknown member");
  return email;
}

export async function queueReadyNotice(db: Db, target: NoticeTarget, pickupDeadline: Date, now: Date): Promise<void> {
  await queueEmail(
    db,
    await emailOf(db, target.memberId),
    `Ready for pickup: ${target.itemName}, unit ${target.unitLabel}`,
    [`Pick up by ${localTime(pickupDeadline)}.`],
    now,
  );
}

export async function queueLapseNotice(db: Db, target: NoticeTarget, pickupDeadline: Date, now: Date): Promise<void> {
  await queueEmail(
    db,
    await emailOf(db, target.memberId),
    `Hold lapsed: ${target.itemName}, unit ${target.unitLabel}`,
    [`Your pickup window closed at ${localTime(pickupDeadline)}. The unit is back on the shelf for other members.`],
    now,
  );
}

export async function queueDueReminder(db: Db, target: NoticeTarget, dueAt: Date, now: Date): Promise<void> {
  await queueEmail(
    db,
    await emailOf(db, target.memberId),
    `Due back ${localTime(dueAt)}: ${target.itemName}, unit ${target.unitLabel}`,
    [`Please return it by ${localTime(dueAt)}, washed out and with batteries charged.`],
    now,
  );
}

export async function queueReceipt(db: Db, target: NoticeTarget, figures: ReceiptFigures, now: Date): Promise<void> {
  await queueEmail(
    db,
    await emailOf(db, target.memberId),
    `Settlement receipt: ${target.itemName}, unit ${target.unitLabel}`,
    receiptLines(figures),
    now,
  );
}
