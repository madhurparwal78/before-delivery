import { formatCents, formatQuarterHours, parseMoney } from '../../shared/money';
import { TimesheetQueueRow, TimesheetStatus } from '../../shared/types';
import { toIsoWithOffset } from '../../shared/time';
import { Db, pool, query, queryOne, withTransaction } from '../db/pool';
import { fail, invalidTransition, notFound } from '../http/errors';
import {
  ChargeItem,
  ensureAccount,
  findChargeByKey,
  postCharge,
  timesheetChargeKey,
} from '../services/killbill';
import { queueEmail } from '../services/mail';
import { timesheetApprovedEmail } from '../services/notifications';
import { deleteObject, putObject, timesheetPdfKey } from '../services/storage';
import { renderPdf } from '../services/pdf';
import { writeAudit } from './audit';
import { ratesMap } from './rates';
import { billedQuarters, timesheetAmountCents } from './rules';
import { RequestRow, loadRequestRow, refreshRequestStatusIn } from './requests';

export interface SubmittedTimesheet {
  id: string;
  status: 'submitted';
  actual_start: string;
  actual_end: string;
  billed_hours: string;
}

interface SeatForTimesheetRow {
  seat_id: string;
  seat_status: string;
  request_id: string;
  interpreter_id: string | null;
  timesheet_id: string | null;
}

export async function submitTimesheet(input: {
  seatId: string;
  interpreterId: string;
  actualStart: Date;
  actualEnd: Date;
  signatureName: string;
  now: Date;
}): Promise<SubmittedTimesheet> {
  return withTransaction(async (client) => {
    if (!/^[0-9a-f-]{36}$/i.test(input.seatId)) throw notFound();
    const seat = await queryOne<SeatForTimesheetRow>(
      client,
      `select s.id as seat_id, s.status as seat_status, s.request_id,
              o.interpreter_id, t.id as timesheet_id
       from seats s
       left join offers o on o.seat_id = s.id and o.status = 'accepted'
       left join timesheets t on t.seat_id = s.id
       where s.id = $1
       for update of s`,
      [input.seatId],
    );
    if (!seat) throw notFound();
    const request = await loadRequestRow(client, seat.request_id);
    if (!request) throw notFound();
    if (seat.seat_status !== 'accepted' || !seat.interpreter_id) throw invalidTransition(seat.seat_status);
    if (seat.interpreter_id !== input.interpreterId) throw fail('forbidden');
    if (request.status === 'cancelled_late' || request.status === 'cancelled_on_time') {
      throw invalidTransition(request.status);
    }
    if (request.end_at.getTime() > input.now.getTime()) throw fail('not_yet_ended');
    if (seat.timesheet_id) throw fail('already_submitted');

    const quarters = billedQuarters(input.actualStart, input.actualEnd);
    const created = await queryOne<{ id: string }>(
      client,
      `insert into timesheets
         (seat_id, request_id, interpreter_id, actual_start, actual_end, signature_name,
          billed_quarters, status, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8)
       returning id`,
      [
        input.seatId,
        seat.request_id,
        input.interpreterId,
        input.actualStart,
        input.actualEnd,
        input.signatureName,
        quarters,
        input.now,
      ],
    );
    if (!created) throw new Error('timesheet insert produced no row');
    await writeAudit(client, {
      actorId: input.interpreterId,
      action: 'timesheet.submitted',
      entity: 'timesheet',
      entityId: created.id,
      requestId: seat.request_id,
      to: 'submitted',
      detail: { billed_hours: formatQuarterHours(quarters), seat_id: input.seatId },
    });
    return {
      id: created.id,
      status: 'submitted' as const,
      actual_start: toIsoWithOffset(input.actualStart),
      actual_end: toIsoWithOffset(input.actualEnd),
      billed_hours: formatQuarterHours(quarters),
    };
  });
}

export async function listSubmittedTimesheets(db: Db): Promise<TimesheetQueueRow[]> {
  const rows = await query<{
    id: string;
    ref: string;
    request_id: string;
    org_id: string;
    interpreter_id: string;
    interpreter_name: string;
    actual_start: Date;
    actual_end: Date;
    billed_quarters: number;
    status: TimesheetStatus;
  }>(
    db,
    `select t.id, r.ref, r.id as request_id, r.org_id, u.id as interpreter_id, u.name as interpreter_name,
            t.actual_start, t.actual_end, t.billed_quarters, t.status
     from timesheets t
     join requests r on r.id = t.request_id
     join users u on u.id = t.interpreter_id
     where t.status = 'submitted'
     order by t.submitted_at, t.id`,
  );
  return rows.map((row) => ({
    id: row.id,
    ref: row.ref,
    request_id: row.request_id,
    org_id: row.org_id,
    interpreter: { id: row.interpreter_id, name: row.interpreter_name },
    actual_start: toIsoWithOffset(row.actual_start),
    actual_end: toIsoWithOffset(row.actual_end),
    billed_hours: formatQuarterHours(row.billed_quarters),
    status: row.status,
  }));
}

export interface TimesheetRow {
  id: string;
  seat_id: string;
  request_id: string;
  interpreter_id: string;
  interpreter_name: string;
  actual_start: Date;
  actual_end: Date;
  signature_name: string;
  billed_quarters: number;
  status: TimesheetStatus;
  hourly_rate_cents: number | null;
  amount_cents: number | null;
  killbill_invoice_id: string | null;
  pdf_key: string | null;
  approved_at: Date | null;
}

export async function loadTimesheet(db: Db, id: string): Promise<TimesheetRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<TimesheetRow>(
    db,
    `select t.*, u.name as interpreter_name
     from timesheets t join users u on u.id = t.interpreter_id
     where t.id = $1`,
    [id],
  );
}

const TIMESHEET_ITEM = /at \$([0-9]+\.[0-9]{2})\/h$/;

function chargeDescription(
  timesheet: TimesheetRow,
  request: RequestRow,
  rateCents: number,
): string {
  return (
    `[${timesheetChargeKey(timesheet.id)}] ${request.ref} interpreting: ${timesheet.interpreter_name}, ` +
    `${formatQuarterHours(timesheet.billed_quarters)} h at $${formatCents(rateCents)}/h`
  );
}

/** Reads the frozen rate out of a charge an earlier uncertain attempt left behind. */
function adoptedRateCents(item: ChargeItem): number {
  const match = TIMESHEET_ITEM.exec(item.description);
  if (!match) throw new Error(`unreadable timesheet charge: ${item.description}`);
  return parseMoney(String(match[1])) ?? 0;
}

export interface ApprovalResult {
  timesheet: {
    id: string;
    status: 'approved';
    billed_hours: string;
    hourly_rate: string;
    amount: string;
    killbill_invoice_id: string;
  };
  request: { ref: string; status: string };
}

/**
 * Approval posts the charge, stores the signed PDF and queues the requester notice
 * together, or does none of them.
 */
export async function approveTimesheet(input: {
  timesheet: TimesheetRow;
  request: RequestRow;
  billingUserId: string;
  billingUserName: string;
  now: Date;
}): Promise<ApprovalResult> {
  const { timesheet, request } = input;
  if (timesheet.status !== 'submitted') throw invalidTransition(timesheet.status);

  const accountId = await ensureAccount(pool, request.org_id, request.org_name);
  const existing = await findChargeByKey(accountId, timesheetChargeKey(timesheet.id));
  const rates = await ratesMap(pool);
  const rateCents = existing ? adoptedRateCents(existing) : rates[request.setting];
  const amountCents = existing
    ? existing.amountCents
    : timesheetAmountCents(timesheet.billed_quarters, rateCents);

  const pdfKey = timesheetPdfKey(request.id, timesheet.id);
  await putObject(
    pdfKey,
    renderPdf([
      `Fernhollow Access timesheet ${request.ref}`,
      `Request: ${request.ref} - ${request.title}`,
      `Organisation: ${request.org_name}`,
      `Interpreter: ${timesheet.interpreter_name}`,
      `Actual start: ${toIsoWithOffset(timesheet.actual_start)}`,
      `Actual end: ${toIsoWithOffset(timesheet.actual_end)}`,
      `Billed hours: ${formatQuarterHours(timesheet.billed_quarters)}`,
      `Hourly rate: $${formatCents(rateCents)}`,
      `Amount: $${formatCents(amountCents)}`,
      `Signature name: ${timesheet.signature_name}`,
      `Approved by ${input.billingUserName} at ${toIsoWithOffset(input.now)}`,
    ]),
    'application/pdf',
  );

  let invoiceId: string;
  try {
    invoiceId = existing
      ? existing.invoiceId
      : (await postCharge(accountId, amountCents, chargeDescription(timesheet, request, rateCents)))
          .invoiceId;
  } catch (error) {
    await deleteObject(pdfKey);
    throw error;
  }

  const requestStatus = await withTransaction(async (client) => {
    const locked = await queryOne<{ status: TimesheetStatus }>(
      client,
      'select status from timesheets where id = $1 for update',
      [timesheet.id],
    );
    if (!locked) throw notFound();
    if (locked.status !== 'submitted') throw invalidTransition(locked.status);
    await client.query(
      `update timesheets
         set status = 'approved', hourly_rate_cents = $2, amount_cents = $3,
             killbill_invoice_id = $4, pdf_key = $5, approved_by = $6, approved_at = $7
       where id = $1`,
      [
        timesheet.id,
        rateCents,
        amountCents,
        invoiceId,
        pdfKey,
        input.billingUserId,
        input.now,
      ],
    );
    await writeAudit(client, {
      actorId: input.billingUserId,
      action: 'timesheet.approved',
      entity: 'timesheet',
      entityId: timesheet.id,
      requestId: request.id,
      from: 'submitted',
      to: 'approved',
      detail: {
        amount: formatCents(amountCents),
        hourly_rate: formatCents(rateCents),
        billed_hours: formatQuarterHours(timesheet.billed_quarters),
      },
    });
    const requesters = await query<{ id: string; name: string; email: string }>(
      client,
      `select id, name, email from users where role = 'requester' and org_id = $1 order by email`,
      [request.org_id],
    );
    for (const requester of requesters) {
      await queueEmail(client, {
        dedupeKey: `timesheet-approved-${timesheet.id}-${requester.id}`,
        ...timesheetApprovedEmail({
          request,
          requesterName: requester.name,
          requesterEmail: requester.email,
          interpreterName: timesheet.interpreter_name,
          billedQuarters: timesheet.billed_quarters,
          amountCents,
        }),
      });
    }
    return refreshRequestStatusIn(client, request.id, input.billingUserId, input.now);
  });

  return {
    timesheet: {
      id: timesheet.id,
      status: 'approved',
      billed_hours: formatQuarterHours(timesheet.billed_quarters),
      hourly_rate: formatCents(rateCents),
      amount: formatCents(amountCents),
      killbill_invoice_id: invoiceId,
    },
    request: { ref: request.ref, status: requestStatus },
  };
}
