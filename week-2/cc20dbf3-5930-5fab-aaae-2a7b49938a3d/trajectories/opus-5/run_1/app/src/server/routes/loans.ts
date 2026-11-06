import { randomUUID } from 'node:crypto';
import {
  addDays,
  closingInstant,
  isOpenDay,
  localDateOf,
  type LocalDate,
} from '../../domain/calendar.js';
import { lateDays } from '../../domain/lateFee.js';
import type { OccupyingSpan } from '../../domain/occupancy.js';
import {
  canCheckOutHold,
  canInspect,
  canRenew,
  canReturn,
  effectiveHoldStatus,
  effectiveLoanStatus,
  HOLD_STATUS_WORDS,
  LOAN_STATUS_WORDS,
  type HoldStatus,
  type LoanStatus,
} from '../../domain/states.js';
import { FIELD_COPY, noSuchCopy } from '../../shared/errors.js';
import { borrowingIsPaused, requireBorrowingAllowed } from '../core/borrowing.js';
import { findItem, findUnit, loadOccupyingSpans, spansFor } from '../core/catalogue.js';
import type { AppContext } from '../core/context.js';
import { decodeCursor, encodeCursor } from '../core/cursor.js';
import { writeLedgerEntry } from '../core/ledger.js';
import { isStaff, presentLoan, presentSettlement, presentUnit } from '../core/present.js';
import { findHold, findLoan, listLoans, type LoanRecord } from '../core/records.js';
import { inTransaction } from '../db/pool.js';
import type { Client } from '../db/pool.js';
import {
  Billing,
  BillingUnavailable,
  depositHoldTransactionKey,
  depositPaymentKey,
} from '../services/billing.js';
import {
  fail,
  failBillingLending,
  failTransition,
  failValidation,
} from '../http/apiError.js';
import type { HandlerResult } from '../http/context.js';
import { sessionRoute, type Route } from '../http/routes.js';
import {
  readDate,
  readInstant,
  readPageParameters,
  readString,
  resolveLoan,
} from './shared.js';

const MAX_LOAN_DAYS = 7;

const LOAN_STATUS_VALUES: readonly LoanStatus[] = [
  'out',
  'overdue',
  'returned',
  'inspected',
  'settled',
];

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

function overlapsSpan(span: OccupyingSpan, from: LocalDate, to: LocalDate): boolean {
  return span.occupiedFrom <= to && from <= span.occupiedTo;
}

/** A deposit is held in billing and in the ledger together with the loan, or not at all. */
async function recordDepositHold(
  billing: Billing,
  client: Client,
  loan: {
    readonly id: string;
    readonly itemId: string;
    readonly memberId: string;
    readonly memberName: string;
    readonly memberEmail: string;
    readonly depositCents: number;
  },
): Promise<void> {
  if (loan.depositCents <= 0) return;
  const accountId = await billing.ensureAccount({
    memberId: loan.memberId,
    name: loan.memberName,
    email: loan.memberEmail,
  });
  await billing.recordPurchase(
    accountId,
    depositPaymentKey(loan.id),
    depositHoldTransactionKey(loan.id),
    loan.depositCents,
  );
  await writeLedgerEntry(client, {
    loanId: loan.id,
    itemId: loan.itemId,
    kind: 'deposit_hold',
    amountCents: loan.depositCents,
  });
}

export function loanRoutes(app: AppContext): Route[] {
  return [
    sessionRoute({
      method: 'POST',
      pattern: '/api/loans',
      body: 'json',
      keyed: true,
      roles: ['volunteer', 'founder'],
      handle: async (context): Promise<HandlerResult> => {
        const holdId = readString(context.json, 'hold_id');
        const loan =
          holdId !== null
            ? await checkOutHold(app, context.now, holdId)
            : await lendWalkIn(app, context.now, context.json);
        return { kind: 'json', status: 201, value: { loan: presentLoan(loan, context.now) } };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/loans',
      handle: async (context): Promise<HandlerResult> => {
        const page = readPageParameters(context.query);
        const rawStatus = context.query.get('status');
        const status = LOAN_STATUS_VALUES.find((value) => value === rawStatus) ?? null;
        const position =
          page.cursor === null ? null : decodeCursor(app.secret, 'loans', page.cursor);
        if (page.cursor !== null && position === null) {
          throw failValidation({ cursor: FIELD_COPY.cursor });
        }
        const loans = await listLoans(app.pool, {
          memberId: isStaff(context.caller) ? null : context.caller.id,
          status,
          now: context.now,
          limit: page.limit + 1,
          cursorInstant: position === null ? null : position.instant,
          cursorId: position === null ? null : position.id,
        });
        const pageRows = loans.slice(0, page.limit);
        const last = pageRows[pageRows.length - 1];
        return {
          kind: 'json',
          status: 200,
          value: {
            loans: pageRows.map((loan) => presentLoan(loan, context.now)),
            next_cursor:
              loans.length > page.limit && last !== undefined
                ? encodeCursor(app.secret, 'loans', {
                    instant: last.checkedOutAt.toISOString(),
                    id: last.id,
                  })
                : null,
          },
        };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/loans/:loanId',
      resolve: (context) => resolveLoan(app, context),
      handle: async (context, loan): Promise<HandlerResult> => ({
        kind: 'json',
        status: 200,
        value: { loan: presentLoan(loan, context.now) },
      }),
    }),

    sessionRoute({
      method: 'POST',
      pattern: '/api/loans/:loanId/renewal',
      body: 'json',
      keyed: true,
      resolve: (context) => resolveLoan(app, context),
      handle: async (context, resolved): Promise<HandlerResult> => {
        const newDueDate = readDate(context.json, 'due_date');
        if (
          newDueDate === null ||
          newDueDate <= resolved.dueDate ||
          newDueDate > addDays(resolved.dueDate, MAX_LOAN_DAYS) ||
          !isOpenDay(app.library.calendar, newDueDate)
        ) {
          throw failValidation({ due_date: FIELD_COPY.due_date_renewal });
        }

        const loan = await inTransaction(app.pool, async (client) => {
          await client.query(`select id from item where id = $1 for no key update`, [resolved.itemId]);
          const locked = await client.query<{
            status: string;
            due_at: Date;
            due_date: LocalDate;
            renewed_at: Date | null;
          }>(`select status, due_at, due_date, renewed_at from loan where id = $1 for no key update`, [
            resolved.id,
          ]);
          const row = locked.rows[0];
          if (row === undefined) throw fail('not_found');
          const status = effectiveLoanStatus(
            row.status as 'out' | 'returned' | 'inspected' | 'settled',
            row.due_at,
            context.now,
          );
          if (!canRenew(status)) throw failTransition('loan', LOAN_STATUS_WORDS[status]);
          if (row.renewed_at !== null) throw fail('renewal_used');
          if (await borrowingIsPaused(client, resolved.memberId, context.now)) {
            throw fail('borrowing_paused');
          }

          const spans = spansFor(
            await loadOccupyingSpans(client, app.library, context.now, resolved.itemId),
            resolved.itemId,
          );
          const extensionFrom = addDays(row.due_date, 1);
          const busy = spans.some(
            (span) =>
              span.unitId === resolved.unit.id &&
              span.recordId !== resolved.id &&
              overlapsSpan(span, extensionFrom, newDueDate),
          );
          if (busy) throw fail('unit_busy');

          await client.query(
            `update loan set due_date = $2, due_at = $3, renewed_at = $4 where id = $1`,
            [
              resolved.id,
              newDueDate,
              closingInstant(app.library.calendar, newDueDate),
              context.now,
            ],
          );
          const updated = await findLoan(client, resolved.id);
          if (updated === null) throw fail('not_found');
          return updated;
        });
        return { kind: 'json', status: 200, value: { loan: presentLoan(loan, context.now) } };
      },
    }),

    sessionRoute({
      method: 'POST',
      pattern: '/api/loans/:loanId/return',
      body: 'json',
      roles: ['volunteer', 'founder'],
      resolve: (context) => resolveLoan(app, context),
      handle: async (context, resolved): Promise<HandlerResult> => {
        let returnedAt = context.now;
        if (context.json['returned_at'] !== undefined) {
          const parsed = readInstant(context.json, 'returned_at');
          if (
            parsed === null ||
            parsed.getTime() < resolved.checkedOutAt.getTime() ||
            parsed.getTime() > context.now.getTime()
          ) {
            throw failValidation({ returned_at: FIELD_COPY.returned_at });
          }
          returnedAt = parsed;
        }

        const loan = await inTransaction(app.pool, async (client) => {
          const locked = await client.query<{ status: string; due_at: Date; due_date: LocalDate }>(
            `select status, due_at, due_date from loan where id = $1 for no key update`,
            [resolved.id],
          );
          const row = locked.rows[0];
          if (row === undefined) throw fail('not_found');
          const status = effectiveLoanStatus(
            row.status as 'out' | 'returned' | 'inspected' | 'settled',
            row.due_at,
            context.now,
          );
          if (!canReturn(status)) throw failTransition('loan', LOAN_STATUS_WORDS[status]);

          const onTime = returnedAt.getTime() <= row.due_at.getTime();
          const late = lateDays(app.library.calendar, row.due_date, returnedAt).length;
          await client.query(
            `update loan set status = 'returned', returned_at = $2, on_time = $3, late_days = $4
             where id = $1`,
            [resolved.id, returnedAt, onTime, late],
          );
          const updated = await findLoan(client, resolved.id);
          if (updated === null) throw fail('not_found');
          return updated;
        });
        return { kind: 'json', status: 200, value: { loan: presentLoan(loan, context.now) } };
      },
    }),

    sessionRoute({
      method: 'POST',
      pattern: '/api/loans/:loanId/inspection',
      body: 'json',
      roles: ['volunteer', 'founder'],
      resolve: (context) => resolveLoan(app, context),
      handle: async (context, resolved): Promise<HandlerResult> => {
        const outcome = readString(context.json, 'outcome');
        const note = readString(context.json, 'note') ?? '';
        const fields: Record<string, string> = {};
        if (outcome !== 'ok' && outcome !== 'damaged') fields['outcome'] = FIELD_COPY.outcome;
        if (outcome === 'damaged' && (note.trim() === '' || note.length > 500)) {
          fields['note'] = FIELD_COPY.note_damage;
        } else if (outcome === 'ok' && note.length > 500) {
          fields['note'] = FIELD_COPY.note_ok;
        }
        if (Object.keys(fields).length > 0) throw failValidation(fields);

        const loan = await inTransaction(app.pool, async (client) => {
          const locked = await client.query<{ status: string; due_at: Date }>(
            `select status, due_at from loan where id = $1 for no key update`,
            [resolved.id],
          );
          const row = locked.rows[0];
          if (row === undefined) throw fail('not_found');
          const status = effectiveLoanStatus(
            row.status as 'out' | 'returned' | 'inspected' | 'settled',
            row.due_at,
            context.now,
          );
          if (!canInspect(status)) throw failTransition('loan', LOAN_STATUS_WORDS[status]);
          await client.query(
            `update loan set status = 'inspected', inspection_outcome = $2,
                    inspection_note = $3, inspected_at = $4
             where id = $1`,
            [resolved.id, outcome, note, context.now],
          );
          const updated = await findLoan(client, resolved.id);
          if (updated === null) throw fail('not_found');
          return updated;
        });
        return { kind: 'json', status: 200, value: { loan: presentLoan(loan, context.now) } };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/loans/:loanId/receipt',
      resolve: (context) => resolveLoan(app, context),
      handle: async (_context, loan): Promise<HandlerResult> => {
        if (loan.settlement === null) throw fail('not_settled');
        return {
          kind: 'json',
          status: 200,
          value: {
            receipt: {
              ...presentSettlement(loan.id, loan.settlement),
              item: { id: loan.itemId, name: loan.itemName },
              unit: presentUnit(loan.unit),
              member: { id: loan.memberId, name: loan.memberName },
            },
          },
        };
      },
    }),
  ];
}

async function checkOutHold(app: AppContext, now: Date, holdId: string): Promise<LoanRecord> {
  const hold = await findHold(app.pool, holdId);
  if (hold === null) throw failValidation({ hold_id: noSuchCopy('hold') });

  try {
    return await inTransaction(app.pool, async (client) => {
      await client.query(`select id from item where id = $1 for no key update`, [hold.itemId]);
      const locked = await client.query<{ status: string; pickup_deadline: Date | null }>(
        `select status, pickup_deadline from hold where id = $1 for no key update`,
        [hold.id],
      );
      const row = locked.rows[0];
      if (row === undefined) throw fail('not_found');
      const status = effectiveHoldStatus(row.status as HoldStatus, row.pickup_deadline, now);
      if (status === 'expired') throw fail('hold_expired');
      if (!canCheckOutHold(status)) throw failTransition('hold', HOLD_STATUS_WORDS[status]);

      const member = await client.query<MemberRow>(
        `select id, name, email, role from person where id = $1`,
        [hold.memberId],
      );
      const memberRow = member.rows[0];
      if (memberRow === undefined) throw fail('not_found');
      if (await borrowingIsPaused(client, hold.memberId, now)) throw fail('borrowing_paused');

      const checkedOutAt = now;
      const startDate = localDateOf(app.library.calendar, checkedOutAt);
      const spans = spansFor(
        await loadOccupyingSpans(client, app.library, now, hold.itemId),
        hold.itemId,
      );
      const busy = spans.some(
        (span) =>
          span.unitId === hold.unit.id &&
          span.recordId !== hold.id &&
          overlapsSpan(span, startDate, hold.endDate),
      );
      if (busy) throw fail('unit_busy');

      await client.query(`update hold set status = 'collected' where id = $1`, [hold.id]);

      const item = await findItem(client, hold.itemId);
      if (item === null) throw fail('not_found');
      const loanId = randomUUID();
      await client.query(
        `insert into loan (id, item_id, unit_id, member_id, hold_id, status, checked_out_at,
                           due_date, due_at, deposit_cents, replacement_cents)
         values ($1, $2, $3, $4, $5, 'out', $6, $7, $8, $9, $10)`,
        [
          loanId,
          item.id,
          hold.unit.id,
          hold.memberId,
          hold.id,
          checkedOutAt,
          hold.endDate,
          closingInstant(app.library.calendar, hold.endDate),
          item.depositCents,
          item.replacementCents,
        ],
      );
      await recordDepositHold(app.billing, client, {
        id: loanId,
        itemId: item.id,
        memberId: memberRow.id,
        memberName: memberRow.name,
        memberEmail: memberRow.email,
        depositCents: item.depositCents,
      });
      const loan = await findLoan(client, loanId);
      if (loan === null) throw fail('not_found');
      return loan;
    });
  } catch (error) {
    if (error instanceof BillingUnavailable) {
      app.probes.noteBillingDown();
      throw failBillingLending();
    }
    throw error;
  }
}

async function lendWalkIn(
  app: AppContext,
  now: Date,
  json: Record<string, unknown>,
): Promise<LoanRecord> {
  const memberId = readString(json, 'member_id');
  const unitId = readString(json, 'unit_id');
  const dueDate = readDate(json, 'due_date');
  const fields: Record<string, string> = {};

  const member = memberId === null ? null : await loadPerson(app, memberId);
  if (member === null || member.role !== 'member') fields['member_id'] = noSuchCopy('member');
  const unit = unitId === null ? null : await findUnit(app.pool, unitId);
  if (unit === null) fields['unit_id'] = noSuchCopy('unit');

  let checkedOutAt = now;
  if (json['checked_out_at'] !== undefined && json['checked_out_at'] !== null) {
    const parsed = readInstant(json, 'checked_out_at');
    if (parsed === null || parsed.getTime() > now.getTime()) {
      fields['checked_out_at'] = FIELD_COPY.checked_out_at;
    } else checkedOutAt = parsed;
  }

  const checkoutDate = localDateOf(app.library.calendar, checkedOutAt);
  if (
    dueDate === null ||
    dueDate < checkoutDate ||
    dueDate > addDays(checkoutDate, MAX_LOAN_DAYS) ||
    !isOpenDay(app.library.calendar, dueDate)
  ) {
    fields['due_date'] = FIELD_COPY.due_date_walk_in;
  }
  if (Object.keys(fields).length > 0) throw failValidation(fields);
  if (member === null || unit === null || dueDate === null) throw failValidation(fields);

  try {
    return await inTransaction(app.pool, async (client) => {
      await client.query(`select id from person where id = $1 for no key update`, [member.id]);
      await client.query(`select id from item where id = $1 for no key update`, [unit.itemId]);

      await requireBorrowingAllowed(client, app.library, member.id, now, true);

      const spans = spansFor(
        await loadOccupyingSpans(client, app.library, now, unit.itemId),
        unit.itemId,
      );
      const busy = spans.some(
        (span) => span.unitId === unit.id && overlapsSpan(span, checkoutDate, dueDate),
      );
      if (busy) throw fail('unit_busy');

      const item = await findItem(client, unit.itemId);
      if (item === null) throw fail('not_found');
      const loanId = randomUUID();
      await client.query(
        `insert into loan (id, item_id, unit_id, member_id, status, checked_out_at,
                           due_date, due_at, deposit_cents, replacement_cents)
         values ($1, $2, $3, $4, 'out', $5, $6, $7, $8, $9)`,
        [
          loanId,
          item.id,
          unit.id,
          member.id,
          checkedOutAt,
          dueDate,
          closingInstant(app.library.calendar, dueDate),
          item.depositCents,
          item.replacementCents,
        ],
      );
      await recordDepositHold(app.billing, client, {
        id: loanId,
        itemId: item.id,
        memberId: member.id,
        memberName: member.name,
        memberEmail: member.email,
        depositCents: item.depositCents,
      });
      const loan = await findLoan(client, loanId);
      if (loan === null) throw fail('not_found');
      return loan;
    });
  } catch (error) {
    if (error instanceof BillingUnavailable) {
      app.probes.noteBillingDown();
      throw failBillingLending();
    }
    throw error;
  }
}

async function loadPerson(app: AppContext, personId: string): Promise<MemberRow | null> {
  const result = await app.pool.query<MemberRow>(
    `select id, name, email, role from person where id = $1`,
    [personId],
  );
  return result.rows[0] ?? null;
}
