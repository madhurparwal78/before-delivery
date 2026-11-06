import { randomUUID } from 'node:crypto';
import { formatLocalTime, type LibraryCalendar } from '../../domain/calendar.js';
import { formatMoney } from '../../domain/money.js';
import type { Queryable } from '../db/queryable.js';
import type { SettlementRecord } from './records.js';

export interface QueuedMessage {
  readonly dedupeKey: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/** Messages go through a queue in PostgreSQL and are sent exactly once. */
export async function queueMessage(db: Queryable, message: QueuedMessage): Promise<void> {
  await db.query(
    `insert into email_message (id, dedupe_key, to_address, subject, body, created_at, next_attempt_at)
     values ($1, $2, $3, $4, $5, now(), now())
     on conflict (dedupe_key) do nothing`,
    [randomUUID(), message.dedupeKey, message.to, message.subject, message.body],
  );
}

interface HoldNotice {
  readonly holdId: string;
  readonly itemName: string;
  readonly unitLabel: string;
  readonly pickupDeadline: Date;
  readonly memberEmail: string;
}

export function readyMessage(calendar: LibraryCalendar, notice: HoldNotice): QueuedMessage {
  return {
    dedupeKey: `hold-ready:${notice.holdId}`,
    to: notice.memberEmail,
    subject: `Ready for pickup: ${notice.itemName}, unit ${notice.unitLabel}`,
    body: `Pick up by ${formatLocalTime(calendar, notice.pickupDeadline)}.`,
  };
}

export function lapseMessage(calendar: LibraryCalendar, notice: HoldNotice): QueuedMessage {
  return {
    dedupeKey: `hold-lapsed:${notice.holdId}`,
    to: notice.memberEmail,
    subject: `Hold lapsed: ${notice.itemName}, unit ${notice.unitLabel}`,
    body:
      `Your pickup window closed at ${formatLocalTime(calendar, notice.pickupDeadline)}. ` +
      'The unit is back on the shelf for other members.',
  };
}

interface LoanNotice {
  readonly loanId: string;
  readonly itemName: string;
  readonly unitLabel: string;
  readonly dueAt: Date;
  readonly memberEmail: string;
}

export function dueReminderMessage(calendar: LibraryCalendar, notice: LoanNotice): QueuedMessage {
  const dueTime = formatLocalTime(calendar, notice.dueAt);
  return {
    dedupeKey: `due-reminder:${notice.loanId}:${notice.dueAt.toISOString()}`,
    to: notice.memberEmail,
    subject: `Due back ${dueTime}: ${notice.itemName}, unit ${notice.unitLabel}`,
    body: `Please return it by ${dueTime}, washed out and with batteries charged.`,
  };
}

/** The six receipt figures, in the order the brief lists them. */
export function receiptLines(settlement: SettlementRecord): string[] {
  return [
    `Deposit held: ${formatMoney(settlement.depositCents)}`,
    `Deposit released: ${formatMoney(settlement.releasedCents)}`,
    `Damage charge: ${formatMoney(settlement.damageCents)}`,
    `Charged beyond deposit: ${formatMoney(settlement.extraDamageCents)}`,
    `Late fee: ${formatMoney(settlement.lateFeeCents)} (${settlement.lateDays} late days)`,
    `Total charged: ${formatMoney(settlement.totalChargedCents)}`,
  ];
}

export function receiptMessage(notice: {
  readonly loanId: string;
  readonly itemName: string;
  readonly unitLabel: string;
  readonly memberEmail: string;
  readonly settlement: SettlementRecord;
}): QueuedMessage {
  return {
    dedupeKey: `receipt:${notice.loanId}`,
    to: notice.memberEmail,
    subject: `Settlement receipt: ${notice.itemName}, unit ${notice.unitLabel}`,
    body: receiptLines(notice.settlement).join('\n'),
  };
}
