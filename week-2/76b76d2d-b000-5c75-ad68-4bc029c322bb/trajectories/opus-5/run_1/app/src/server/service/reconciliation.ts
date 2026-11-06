import { one, query, transaction } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { formatDollars } from '../../shared/money.ts';
import { instantFromDateAt, addCalendarDays, toIso } from '../domain/time.ts';
import { allBillingAccounts } from '../repo/accounts.ts';
import { listPayments } from '../killbill/client.ts';
import { writeAudit } from '../repo/audit.ts';

export type Reconciliation = {
  date: string;
  timezone: 'America/Toronto';
  window_start: string;
  window_end: string;
  local: {
    admission_cents: number;
    gst_cents: number;
    qst_cents: number;
    uplift_cents: number;
    gift_cents: number;
    membership_cents: number;
    credit_spent_cents: number;
    refunds_cents: number;
    net_payments_cents: number;
  };
  killbill: { payments_cents: number; refunds_cents: number; net_payments_cents: number };
  difference_cents: number;
  status: 'matched' | 'mismatch' | 'accepted';
  accepted_difference_cents: number | null;
};

export function businessDayWindow(date: string): { start: Date; end: Date } {
  return {
    start: instantFromDateAt(date, 0, 0),
    end: instantFromDateAt(addCalendarDays(date, 1), 0, 0),
  };
}

type LocalRows = {
  bookings: Array<{
    ref: string;
    name: string;
    note: string;
    admission_cents: number;
    gst_cents: number;
    qst_cents: number;
    uplift_cents: number;
    credit_applied_cents: number;
    paid_cents: number;
    paid_at: Date;
  }>;
  gifts: Array<{
    ref: string;
    purchaser_name: string;
    price_cents: number;
    credit_applied_cents: number;
    paid_cents: number;
    created_at: Date;
  }>;
  refunds: Array<{ ref: string; name: string; note: string; refunded_cents: number; refunded_at: Date }>;
  memberships: Array<{
    account_number: string;
    name: string;
    amount_cents: number;
    credit_applied_cents: number;
    occurred_at: Date;
  }>;
};

async function localRows(start: Date, end: Date): Promise<LocalRows> {
  const bookings = await query<LocalRows['bookings'][number]>(
    `select ref, name, note, admission_cents, gst_cents, qst_cents, uplift_cents,
            credit_applied_cents, paid_cents, paid_at
       from bookings where paid_at >= $1 and paid_at < $2 order by paid_at asc, ref asc`,
    [start.toISOString(), end.toISOString()],
  );
  const gifts = await query<LocalRows['gifts'][number]>(
    `select ref, purchaser_name, price_cents, credit_applied_cents, paid_cents, created_at
       from gifts where created_at >= $1 and created_at < $2 order by created_at asc, ref asc`,
    [start.toISOString(), end.toISOString()],
  );
  const refunds = await query<LocalRows['refunds'][number]>(
    `select ref, name, note, coalesce(refunded_cents, 0) as refunded_cents, refunded_at
       from bookings where refunded_at >= $1 and refunded_at < $2 order by refunded_at asc, ref asc`,
    [start.toISOString(), end.toISOString()],
  );
  const memberships = await query<LocalRows['memberships'][number]>(
    `select a.number as account_number, a.name, i.amount_cents, i.credit_applied_cents,
            i.created_at as occurred_at
       from membership_invoices i join accounts a on a.id = i.account_id
      where i.created_at >= $1 and i.created_at < $2 and i.amount_cents > 0
      order by i.created_at asc, a.number asc`,
    [start.toISOString(), end.toISOString()],
  );
  return { bookings, gifts, refunds, memberships };
}

async function killbillFigures(start: Date, end: Date): Promise<{ payments: number; refunds: number }> {
  const accounts = await allBillingAccounts();
  let payments = 0;
  let refunds = 0;
  for (const account of accounts) {
    const list = await listPayments(account.kb_account_id);
    for (const payment of list) {
      for (const transaction of payment.transactions) {
        if (transaction.status !== 'SUCCESS') continue;
        const at = new Date(transaction.effective_date).getTime();
        if (at < start.getTime() || at >= end.getTime()) continue;
        if (transaction.type === 'PURCHASE') payments += transaction.amount_cents;
        if (transaction.type === 'REFUND') refunds += transaction.amount_cents;
      }
    }
  }
  return { payments, refunds };
}

export async function reconciliationFor(date: string): Promise<Reconciliation> {
  const { start, end } = businessDayWindow(date);
  const rows = await localRows(start, end);
  const admission = rows.bookings.reduce((sum, row) => sum + row.admission_cents, 0);
  const gst = rows.bookings.reduce((sum, row) => sum + row.gst_cents, 0);
  const qst = rows.bookings.reduce((sum, row) => sum + row.qst_cents, 0);
  const uplift = rows.bookings.reduce((sum, row) => sum + row.uplift_cents, 0);
  const gift = rows.gifts.reduce((sum, row) => sum + row.price_cents, 0);
  const membership = rows.memberships.reduce((sum, row) => sum + row.amount_cents, 0);
  const creditSpent =
    rows.bookings.reduce((sum, row) => sum + row.credit_applied_cents, 0) +
    rows.gifts.reduce((sum, row) => sum + row.credit_applied_cents, 0) +
    rows.memberships.reduce((sum, row) => sum + row.credit_applied_cents, 0);
  const refundsCents = rows.refunds.reduce((sum, row) => sum + row.refunded_cents, 0);
  const localNet = admission + gst + qst + uplift + gift + membership - creditSpent - refundsCents;
  const killbill = await killbillFigures(start, end);
  const killbillNet = killbill.payments - killbill.refunds;
  const difference = killbillNet - localNet;
  const acceptance = await one<{ difference_cents: number }>(
    'select difference_cents from reconciliation_acceptances where business_day = $1',
    [date],
  );
  const accepted = acceptance !== null && acceptance.difference_cents === difference;
  return {
    date,
    timezone: 'America/Toronto',
    window_start: toIso(start),
    window_end: toIso(end),
    local: {
      admission_cents: admission,
      gst_cents: gst,
      qst_cents: qst,
      uplift_cents: uplift,
      gift_cents: gift,
      membership_cents: membership,
      credit_spent_cents: creditSpent,
      refunds_cents: refundsCents,
      net_payments_cents: localNet,
    },
    killbill: {
      payments_cents: killbill.payments,
      refunds_cents: killbill.refunds,
      net_payments_cents: killbillNet,
    },
    difference_cents: difference,
    status: difference === 0 ? 'matched' : accepted ? 'accepted' : 'mismatch',
    accepted_difference_cents: acceptance?.difference_cents ?? null,
  };
}

export async function acceptReconciliation(input: {
  date: string;
  reason: string;
  actor: string;
}): Promise<Reconciliation> {
  const current = await reconciliationFor(input.date);
  if (current.difference_cents === 0) throw new ApiError('nothing_to_accept');
  await transaction(async (tx) => {
    await tx.query(
      `insert into reconciliation_acceptances(business_day, difference_cents, reason)
         values($1,$2,$3) on conflict (business_day) do update
         set difference_cents = excluded.difference_cents, reason = excluded.reason, accepted_at = now()`,
      [input.date, current.difference_cents, input.reason],
    );
    await writeAudit(tx, {
      actor: input.actor,
      action: 'reconciliation-accept',
      target: input.date,
      amountCents: current.difference_cents,
      reason: input.reason,
    });
  });
  return reconciliationFor(input.date);
}

function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

export async function reconciliationCsv(date: string): Promise<string> {
  const { start, end } = businessDayWindow(date);
  const rows = await localRows(start, end);
  type CsvRow = { sort: number; reference: string; cells: string[] };
  const zero = '0.00';
  const out: CsvRow[] = [];
  for (const booking of rows.bookings) {
    out.push({
      sort: booking.paid_at.getTime(),
      reference: booking.ref,
      cells: [
        'booking',
        booking.ref,
        toIso(booking.paid_at),
        csvCell(booking.name),
        csvCell(booking.note),
        formatDollars(booking.admission_cents),
        formatDollars(booking.gst_cents),
        formatDollars(booking.qst_cents),
        formatDollars(booking.uplift_cents),
        zero,
        zero,
        formatDollars(booking.credit_applied_cents),
        formatDollars(
          booking.admission_cents +
            booking.gst_cents +
            booking.qst_cents +
            booking.uplift_cents -
            booking.credit_applied_cents,
        ),
        zero,
      ],
    });
  }
  for (const gift of rows.gifts) {
    out.push({
      sort: gift.created_at.getTime(),
      reference: gift.ref,
      cells: [
        'gift',
        gift.ref,
        toIso(gift.created_at),
        csvCell(gift.purchaser_name),
        '',
        zero,
        zero,
        zero,
        zero,
        formatDollars(gift.price_cents),
        zero,
        formatDollars(gift.credit_applied_cents),
        formatDollars(gift.price_cents - gift.credit_applied_cents),
        zero,
      ],
    });
  }
  for (const membership of rows.memberships) {
    out.push({
      sort: membership.occurred_at.getTime(),
      reference: membership.account_number,
      cells: [
        'membership',
        membership.account_number,
        toIso(membership.occurred_at),
        csvCell(membership.name),
        '',
        zero,
        zero,
        zero,
        zero,
        zero,
        formatDollars(membership.amount_cents),
        formatDollars(membership.credit_applied_cents),
        formatDollars(membership.amount_cents - membership.credit_applied_cents),
        zero,
      ],
    });
  }
  for (const refund of rows.refunds) {
    out.push({
      sort: refund.refunded_at.getTime(),
      reference: refund.ref,
      cells: [
        'refund',
        refund.ref,
        toIso(refund.refunded_at),
        csvCell(refund.name),
        csvCell(refund.note),
        zero,
        zero,
        zero,
        zero,
        zero,
        zero,
        zero,
        zero,
        formatDollars(refund.refunded_cents),
      ],
    });
  }
  out.sort((a, b) => a.sort - b.sort || (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0));
  const header =
    'kind,reference,occurred_at,patron_name,note,admission,gst,qst,uplift,gift,membership,credit_spent,paid,refunded';
  return [header, ...out.map((row) => row.cells.join(','))].join('\r\n') + '\r\n';
}

