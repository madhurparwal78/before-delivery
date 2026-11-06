// Loans: checkout of a ready hold, walk-in (optionally back-timed) loans, one renewal, check-in and
// inspection, plus the due reminders.

import { randomUUID } from "node:crypto";
import type { InspectionOutcome, LoanStatus } from "../../shared/api.js";
import { addDays, closingInstant, localDate } from "../../shared/calendar.js";
import { FIELD_COPY, noSuchCopy } from "../../shared/copy.js";
import { config } from "../config.js";
import { type Db, lockKey, pool, withTransaction } from "../db.js";
import { ApiError, FieldErrors } from "../http/errors.js";
import { BillingUnavailable, recordDepositHold } from "../services/killbill.js";
import { assertNotPaused, assertUnderLimit } from "./borrowing.js";
import { renewalDueOk, walkInDueOk } from "../../shared/windows.js";
import { asObject, assertHoldMove } from "./holds.js";
import { lateDates } from "./latefee.js";
import { recordLedgerEntry } from "./ledger.js";
import { library, today } from "./library.js";
import { queueDueReminder } from "./notices.js";
import { activeSpans, isUnitFree, loanSpan } from "./occupancy.js";
import { isUuid, type LoanRow, readHold, readLoan } from "./records.js";
import { isOverdueAt } from "./status.js";

const LOAN_MOVES = {
  renew: ["out"],
  return: ["out", "overdue"],
  inspect: ["returned"],
  settle: ["inspected"],
  photo: ["out", "overdue", "returned"],
} as const satisfies Record<string, readonly LoanStatus[]>;

/** The one decision on whether a loan may make a move. */
export function assertLoanMove(move: keyof typeof LOAN_MOVES, status: LoanStatus): void {
  if (!(LOAN_MOVES[move] as readonly LoanStatus[]).includes(status)) throw ApiError.invalidTransition("loan", status);
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !INSTANT.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The due instant: the library's closing time on the due date. */
export const dueAt = (dueDate: string): Date => closingInstant(library().calendar, dueDate);

type CheckoutRequest =
  | { kind: "hold"; holdId: string }
  | { kind: "walk-in"; memberId: string; unitId: string; itemId: string; dueDate: string; checkedOutAt: Date };

export async function parseCheckoutRequest(json: unknown, now: Date): Promise<CheckoutRequest> {
  const body = asObject(json);
  const fields = new FieldErrors();
  if ("hold_id" in body) {
    const known = isUuid(body.hold_id) && (await pool.query("SELECT 1 FROM hold WHERE id = $1", [body.hold_id])).rowCount;
    if (!known) fields.add("hold_id", noSuchCopy("hold"));
    fields.throwIfAny();
    return { kind: "hold", holdId: body.hold_id as string };
  }
  const member = await pool.query("SELECT 1 FROM person WHERE id = $1 AND role = 'member'", [String(body.member_id ?? "")]);
  if (!member.rowCount) fields.add("member_id", noSuchCopy("member"));
  const unit = await pool.query<{ item_id: string }>("SELECT item_id FROM unit WHERE id = $1", [String(body.unit_id ?? "")]);
  const itemId = unit.rows[0]?.item_id;
  if (!itemId) fields.add("unit_id", noSuchCopy("unit"));
  const checkedOutAt = body.checked_out_at === undefined || body.checked_out_at === null ? now : parseInstant(body.checked_out_at);
  if (!checkedOutAt || checkedOutAt > now) fields.add("checked_out_at", FIELD_COPY.checked_out_at);
  const from = localDate(checkedOutAt ?? now, library().calendar.timeZone);
  const due = body.due_date;
  if (!walkInDueOk(library().calendar, from, due)) fields.add("due_date", FIELD_COPY.due_date_walk_in);
  fields.throwIfAny();
  return {
    kind: "walk-in",
    memberId: body.member_id as string,
    unitId: body.unit_id as string,
    itemId: itemId as string,
    dueDate: due as string,
    checkedOutAt: checkedOutAt as Date,
  };
}

interface Lending {
  memberId: string;
  itemId: string;
  unitId: string;
  holdId: string | null;
  checkedOutAt: Date;
  dueDate: string;
}

/** Creates the loan, its deposit-hold ledger entry and the Kill Bill deposit purchase, inside the caller's
 * transaction: if billing fails the transaction rolls back and none of them exist. */
async function lend(db: Db, lending: Lending, now: Date): Promise<string> {
  const item = await db.query<{ deposit_cents: number; replacement_cents: number }>(
    "SELECT deposit_cents, replacement_cents FROM item WHERE id = $1",
    [lending.itemId],
  );
  const priced = item.rows[0];
  if (!priced) throw new Error("loan for an unknown item");
  const { deposit_cents: deposit, replacement_cents: replacement } = priced;
  const loanId = randomUUID();
  await db.query(
    `INSERT INTO loan (id, member_id, item_id, unit_id, hold_id, status, checked_out_at, due_date, due_at, deposit_cents, replacement_cents)
     VALUES ($1, $2, $3, $4, $5, 'out', $6, $7, $8, $9, $10)`,
    [loanId, lending.memberId, lending.itemId, lending.unitId, lending.holdId, lending.checkedOutAt, lending.dueDate, dueAt(lending.dueDate), deposit, replacement],
  );
  if (deposit > 0) {
    await recordLedgerEntry(db, loanId, "deposit_hold", deposit, now);
    const payer = await db.query<{ id: string; name: string; email: string }>("SELECT id, name, email FROM person WHERE id = $1", [
      lending.memberId,
    ]);
    const member = payer.rows[0];
    if (!member) throw new Error("loan for an unknown member");
    try {
      await recordDepositHold(member, loanId, deposit);
    } catch (error) {
      if (error instanceof BillingUnavailable) throw ApiError.billingUnavailable("lend");
      throw error;
    }
  }
  return loanId;
}

/** Turns a ready hold into a loan due on the hold's return date. The hold row is locked first, so racing
 * checkouts and cancels are decided one at a time and a loser never reaches billing. */
export async function checkoutHold(holdId: string, now: Date): Promise<string> {
  return withTransaction(async (db) => {
    const hold = await readHold(db, now, holdId, true);
    if (!hold) throw ApiError.of("not_found");
    assertHoldMove("collect", hold.status);
    await lockKey(db, "item", hold.item_id);
    await assertNotPaused(db, now, hold.member_id);
    const spans = await activeSpans(db, now, [hold.item_id]);
    if (!isUnitFree(spans, hold.unit_id, today(now), hold.end_date, hold.id)) throw ApiError.of("unit_busy");
    await db.query("UPDATE hold SET status = 'collected' WHERE id = $1", [holdId]);
    return lend(
      db,
      { memberId: hold.member_id, itemId: hold.item_id, unitId: hold.unit_id, holdId, checkedOutAt: now, dueDate: hold.end_date },
      now,
    );
  });
}

export async function lendWalkIn(request: Extract<CheckoutRequest, { kind: "walk-in" }>, now: Date): Promise<string> {
  return withTransaction(async (db) => {
    await lockKey(db, "member", request.memberId);
    await lockKey(db, "item", request.itemId);
    await assertNotPaused(db, now, request.memberId);
    await assertUnderLimit(db, now, request.memberId);
    const span = loanSpan(request.checkedOutAt, request.dueDate, isOverdueAt(dueAt(request.dueDate), now), now);
    if (!isUnitFree(await activeSpans(db, now, [request.itemId]), request.unitId, span.start, span.end)) {
      throw ApiError.of("unit_busy");
    }
    return lend(db, { ...request, holdId: null }, now);
  });
}

export function parseRenewal(json: unknown, loan: LoanRow): string {
  const due = asObject(json).due_date;
  if (!renewalDueOk(library().calendar, loan.due_date, due)) throw ApiError.validation({ due_date: FIELD_COPY.due_date_renewal });
  return due;
}

/** One renewal per loan, never billed; decided under the item's claim lock so it races holds fairly. */
export async function renewLoan(loan: LoanRow, newDueDate: string, now: Date): Promise<void> {
  await withTransaction(async (db) => {
    await lockKey(db, "item", loan.item_id);
    const current = await readLoan(db, now, loan.id, true);
    if (!current) throw ApiError.of("not_found");
    assertLoanMove("renew", current.status);
    if (current.renewed_at) throw ApiError.of("renewal_used");
    await assertNotPaused(db, now, current.member_id);
    const spans = await activeSpans(db, now, [current.item_id]);
    if (!isUnitFree(spans, current.unit_id, addDays(current.due_date, 1), newDueDate, current.id)) throw ApiError.of("unit_busy");
    await db.query("UPDATE loan SET due_date = $2, due_at = $3, renewed_at = $4 WHERE id = $1", [loan.id, newDueDate, dueAt(newDueDate), now]);
  });
}

export function parseReturn(json: unknown, loan: LoanRow, now: Date): Date {
  const given = asObject(json).returned_at;
  if (given === undefined || given === null) return now;
  const returnedAt = parseInstant(given);
  if (!returnedAt || returnedAt < loan.checked_out_at || returnedAt > now) {
    throw ApiError.validation({ returned_at: FIELD_COPY.returned_at });
  }
  return returnedAt;
}

export async function checkIn(loanId: string, returnedAt: Date, now: Date): Promise<void> {
  await withTransaction(async (db) => {
    const loan = await readLoan(db, now, loanId, true);
    if (!loan) throw ApiError.of("not_found");
    assertLoanMove("return", loan.status);
    const late = lateDates(library().calendar, loan.due_date, returnedAt);
    await db.query("UPDATE loan SET status = 'returned', returned_at = $2, on_time = $3, late_days = $4 WHERE id = $1", [
      loanId,
      returnedAt,
      returnedAt <= loan.due_at,
      late.length,
    ]);
  });
}

const NOTE_MAX = 500;

export function parseInspection(json: unknown): { outcome: InspectionOutcome; note: string } {
  const body = asObject(json);
  const fields = new FieldErrors();
  const outcome = body.outcome;
  if (outcome !== "ok" && outcome !== "damaged") fields.add("outcome", FIELD_COPY.outcome);
  const note = typeof body.note === "string" ? body.note : "";
  if (outcome === "damaged" && (note.trim() === "" || note.length > NOTE_MAX)) fields.add("note", FIELD_COPY.note_damaged);
  if (outcome !== "damaged" && note.length > NOTE_MAX) fields.add("note", FIELD_COPY.note_ok);
  fields.throwIfAny();
  return { outcome: outcome as InspectionOutcome, note };
}

export async function inspect(loanId: string, outcome: InspectionOutcome, note: string, now: Date): Promise<void> {
  await withTransaction(async (db) => {
    const loan = await readLoan(db, now, loanId, true);
    if (!loan) throw ApiError.of("not_found");
    assertLoanMove("inspect", loan.status);
    await db.query(
      "UPDATE loan SET status = 'inspected', inspection_outcome = $2, inspection_note = $3, inspected_at = $4 WHERE id = $1",
      [loanId, outcome, note, now],
    );
  });
}

/** Background work: one reminder per loan and per due instant, once now is within the reminder lead of it.
 * The (loan, due instant) key makes it exactly once across every copy of the server. */
export async function queueDueReminders(now: Date): Promise<void> {
  await withTransaction(async (db) => {
    const due = await db.query<{ loan_id: string; due_at: Date }>(
      `INSERT INTO due_reminder (loan_id, due_at)
       SELECT l.id, l.due_at FROM loan l
       WHERE l.status = 'out' AND l.due_at > $1 AND l.due_at <= $1 + make_interval(secs => $2)
       ON CONFLICT DO NOTHING RETURNING loan_id, due_at`,
      [now, config.reminderLeadSeconds],
    );
    for (const { loan_id: loanId, due_at: dueInstant } of due.rows) {
      const loan = await readLoan(db, now, loanId);
      if (loan) {
        await queueDueReminder(db, { memberId: loan.member_id, itemName: loan.item_name, unitLabel: loan.unit_label }, dueInstant, now);
      }
    }
  });
}
