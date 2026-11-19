import type { PoolClient } from 'pg';
import * as copy from '../../../shared/copy';
import { parseTimestamp } from '../../../shared/time';
import type { Grade, LoanStatus } from '../../../shared/types';
import type { OpeningCalendar } from '../../domain/calendar';
import { feeLinesFor, lateFeeSoFarCents, totalCents, type FeeItem } from '../../domain/fees';
import { checkinConflict, finishConflict } from '../../domain/transitions';
import { promoteHoldForItem } from '../../actions/hold-promotion';
import { readCalendar } from '../../repo/calendar';
import { pool, withTransaction } from '../../repo/db';
import { feeView, insertFee, readFeeRow } from '../../repo/fees';
import { setPartState } from '../../repo/inventory';
import {
  loanView,
  lockLoanRow,
  readLoanItems,
  readLoanParts,
  readLoanRow,
  recordCheckinOutcome,
  setGrades,
  type LoanRow,
} from '../../repo/loans';
import { BillingUnreachable, invoiceNumberOf, raiseFeeInvoice } from '../../services/killbill';
import { feeReceiptMail, queueMail } from '../../services/mail';
import { billingProbe, storageProbe } from '../../services/status';
import { StorageUnreachable } from '../../services/storage';
import * as fail from '../errors';
import { FieldProblems } from '../errors';
import { jsonReply, type Reply, type Route } from '../pipeline';
import { removeStoredPhoto, storePhoto, validatePhotoUpload } from './photos';

function staffOnly(role: string | null): void {
  if (role === 'member' || role === null) throw fail.staffOnly();
}

function storageDown(message: string): never {
  storageProbe.markDown();
  throw fail.providerDown(message);
}

function billingDown(message: string): never {
  billingProbe.markDown();
  throw fail.providerDown(message);
}

function feeItemsOf(items: readonly { id: number; tag: string; name: string; grade: Grade | null }[]): FeeItem[] {
  return items.map((item) => ({
    id: item.id,
    tag: item.tag,
    name: item.name,
    grade: item.grade,
  }));
}

/** Every item on the loan needs a grade before a check-in can be confirmed. */
function parseGrades(
  problems: FieldProblems,
  text: string | undefined,
  itemIds: readonly number[],
): Map<number, Grade> {
  const grades = new Map<number, Grade>();
  const refuse = (): Map<number, Grade> => {
    problems.add('grades', 'Grade every tool on this loan.');
    return grades;
  };
  if (text === undefined) return refuse();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return refuse();
  const record = parsed as Record<string, unknown>;
  for (const itemId of itemIds) {
    const grade = record[String(itemId)];
    if (grade !== 'good' && grade !== 'worn' && grade !== 'damaged') return refuse();
    grades.set(itemId, grade);
  }
  return grades;
}

/**
 * The one check-in outcome: parts left unhung go missing, the fee is computed
 * from the loan's recorded fee rules, and Kill Bill records it exactly once.
 * A loan finished after a storage outage reuses its recorded open days late, so
 * time spent waiting adds no lateness.
 */
async function completeCheckin(
  client: PoolClient,
  row: LoanRow,
  returnedAt: Date,
  calendar: OpeningCalendar,
  recordedOpenDaysLate: number | null,
): Promise<void> {
  if (row.due_date === null || row.fee_rules === null) throw fail.notFound();
  const parts = await readLoanParts(client, row.id);
  const unhung = parts.filter((part) => part.state !== 'hung');
  for (const part of unhung) await setPartState(client, part.id, 'missing');
  const status: LoanStatus = unhung.length === 0 ? 'returned-complete' : 'returned-partial';

  const items = await readLoanItems(client, row.id);
  const feeItems = feeItemsOf(items);
  const openDaysLate = recordedOpenDaysLate ?? calendar.openDaysLate(row.due_date, returnedAt);
  const lines = feeLinesFor(feeItems, openDaysLate, row.fee_rules);
  const lateFeeCents = lateFeeSoFarCents(feeItems, openDaysLate, row.fee_rules);

  if (lines.length > 0) {
    const membership = await client.query<{ killbill_account_id: string | null }>(
      'select killbill_account_id from memberships where user_id = $1',
      [row.member_id],
    );
    const accountId = membership.rows[0]?.killbill_account_id;
    if (!accountId) billingDown(copy.BILLING_DOWN_CHECKIN);
    let invoiceId: string;
    try {
      invoiceId = await raiseFeeInvoice(accountId, lines);
      billingProbe.markUp();
    } catch (error) {
      if (error instanceof BillingUnreachable) billingDown(copy.BILLING_DOWN_CHECKIN);
      throw error;
    }
    const total = totalCents(lines);
    const feeId = await insertFee(client, row.id, row.member_id, lines, total, invoiceId);
    const member = await client.query<{ email: string }>('select email from users where id = $1', [
      row.member_id,
    ]);
    const email = member.rows[0]?.email;
    if (email) {
      const receipt = feeReceiptMail(
        row.ref,
        feeId,
        lines,
        total,
        await invoiceNumberOf(invoiceId),
      );
      await queueMail(client, `fee-receipt:${feeId}`, email, receipt.subject, receipt.body);
    }
  }

  await recordCheckinOutcome(client, row.id, status, returnedAt, openDaysLate, lateFeeCents);
  if (status === 'returned-complete') {
    for (const item of items) await promoteHoldForItem(client, item.id, calendar, new Date());
  }
}

/**
 * Storage is down, so the check-in waits with its grades, return time, hung set
 * and overdue figures recorded, with nothing charged and no photo stored.
 */
async function holdAsPendingPhoto(
  client: PoolClient,
  row: LoanRow,
  returnedAt: Date,
  calendar: OpeningCalendar,
  now: Date,
): Promise<Reply> {
  const feeItems = feeItemsOf(await readLoanItems(client, row.id));
  const openDaysLate =
    row.due_date === null ? 0 : calendar.openDaysLate(row.due_date, returnedAt);
  const lateFee =
    row.fee_rules === null ? 0 : lateFeeSoFarCents(feeItems, openDaysLate, row.fee_rules);
  await client.query(
    `update loans set status = 'pending-photo', returned_at = $2,
     recorded_open_days_late = $3, recorded_late_fee_cents = $4 where id = $1`,
    [row.id, returnedAt.toISOString(), openDaysLate, lateFee],
  );
  const waiting = await readLoanRow(client, row.id);
  if (!waiting) throw fail.notFound();
  return jsonReply(202, { loan: await loanView(client, waiting, calendar, now), fee: null });
}

async function checkinReply(
  client: PoolClient,
  loanId: number,
  calendar: OpeningCalendar,
  now: Date,
): Promise<Reply> {
  const row = await readLoanRow(client, loanId);
  if (!row) throw fail.notFound();
  const loan = await loanView(client, row, calendar, now);
  const feeRow = loan.fee_id === null ? null : await readFeeRow(client, loan.fee_id);
  return jsonReply(200, {
    loan,
    fee: feeRow ? await feeView(client, feeRow, calendar.timeZone) : null,
  });
}

export const checkinRoute: Route<{ id: number }> = {
  method: 'POST',
  pattern: '/api/loans/:id/checkin',
  body: 'multipart',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const id = ctx.pathId('id');
    if (!(await readLoanRow(pool, id))) throw fail.notFound();
    return { id };
  },
  role: (ctx) => staffOnly(ctx.role),
  run: async (ctx, resolved): Promise<Reply> => {
    const form = ctx.multipart();
    const items = await readLoanItems(pool, resolved.id);
    const problems = new FieldProblems();
    const grades = parseGrades(
      problems,
      form.fields.get('grades'),
      items.map((item) => item.id),
    );
    const loanRow = await readLoanRow(pool, resolved.id);
    const returnedAtText = form.fields.get('returned_at');
    let returnedAt: Date | null = null;
    if (returnedAtText !== undefined && returnedAtText !== '') {
      const parsed = parseTimestamp(returnedAtText);
      if (parsed === null) {
        problems.add('returned_at', 'Give an ISO 8601 time with an offset.');
      } else if (parsed.getTime() > ctx.now.getTime()) {
        problems.add('returned_at', 'That return time is in the future.');
      } else if (loanRow?.checked_out_at && parsed.getTime() < loanRow.checked_out_at.getTime()) {
        problems.add('returned_at', 'That return time is before the loan was checked out.');
      } else {
        returnedAt = parsed;
      }
    }
    const upload = validatePhotoUpload(
      problems,
      form.files.get('photo'),
      form.fields.get('captured_at'),
      ctx.now,
    );
    problems.throwIfAny();
    if (!upload) throw fail.invalid({ photo: 'Take or choose a photo.' });

    return withTransaction(async (client) => {
      const row = await lockLoanRow(client, resolved.id);
      if (!row) throw fail.notFound();
      const conflict = checkinConflict(row.status);
      if (conflict) throw fail.conflict(conflict);
      const calendar = await readCalendar(client);
      await setGrades(client, row.id, grades);
      const effectiveReturn = returnedAt ?? ctx.now;

      let photoId: number;
      try {
        photoId = await storePhoto(client, row.id, row.ref, 'checkin', upload);
      } catch (error) {
        if (!(error instanceof StorageUnreachable)) throw error;
        return holdAsPendingPhoto(client, row, effectiveReturn, calendar, ctx.now);
      }
      try {
        await completeCheckin(client, row, effectiveReturn, calendar, null);
      } catch (error) {
        await removeStoredPhoto(client, photoId);
        throw error;
      }
      return checkinReply(client, row.id, calendar, ctx.now);
    });
  },
};

export const finishRoute: Route<{ id: number }> = {
  method: 'POST',
  pattern: '/api/loans/:id/finish',
  body: 'multipart',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const id = ctx.pathId('id');
    if (!(await readLoanRow(pool, id))) throw fail.notFound();
    return { id };
  },
  role: (ctx) => staffOnly(ctx.role),
  run: async (ctx, resolved): Promise<Reply> => {
    const form = ctx.multipart();
    const problems = new FieldProblems();
    const upload = validatePhotoUpload(
      problems,
      form.files.get('photo'),
      form.fields.get('captured_at'),
      ctx.now,
    );
    problems.throwIfAny();
    if (!upload) throw fail.invalid({ photo: 'Take or choose a photo.' });

    return withTransaction(async (client) => {
      const row = await lockLoanRow(client, resolved.id);
      if (!row) throw fail.notFound();
      const conflict = finishConflict(row.status);
      if (conflict) throw fail.conflict(conflict);
      const calendar = await readCalendar(client);
      let photoId: number;
      try {
        photoId = await storePhoto(client, row.id, row.ref, 'checkin', upload);
      } catch (error) {
        if (error instanceof StorageUnreachable) storageDown(copy.STORAGE_DOWN_FINISH);
        throw error;
      }
      try {
        await completeCheckin(
          client,
          row,
          row.returned_at ?? ctx.now,
          calendar,
          row.recorded_open_days_late,
        );
      } catch (error) {
        await removeStoredPhoto(client, photoId);
        throw error;
      }
      return checkinReply(client, row.id, calendar, ctx.now);
    });
  },
};
