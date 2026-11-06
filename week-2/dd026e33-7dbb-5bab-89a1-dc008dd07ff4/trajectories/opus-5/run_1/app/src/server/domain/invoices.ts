import { formatMoney, parseMoney } from '../../shared/money';
import { zurichDate } from '../../shared/zurich';
import type { HoldingInvoice, Invoice, Payment } from '../../shared/types';
import { query, type QueryValue } from '../db';
import {
  BillingUnavailable,
  readInvoice as readKillBillInvoice,
  readInvoicePayments,
  type KbPayment,
} from '../providers/killbill';
import { carName } from './cars';
import { lineTotals, toLines, type LineRow } from './jobs';

export interface InvoiceRow {
  id: string;
  number: string;
  job_id: string;
  car_id: string;
  owner_id: string;
  owner_name: string;
  car_year: number;
  car_make: string;
  car_model: string;
  killbill_invoice_id: string;
  killbill_account_id: string;
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
  issued_at: Date;
  last_balance: string;
  last_status: 'awaiting_payment' | 'paid';
  status_confirmed_at: Date;
  paid_at: string | null;
}

export const INVOICE_SELECT = `
  select i.*, u.name as owner_name, c.year as car_year, c.make as car_make, c.model as car_model
  from invoices i
  join users u on u.id = i.owner_id
  join cars c on c.id = i.car_id`;

interface TransferRow {
  killbill_payment_id: string | null;
  reference: string;
  recorded_by: string;
  recorded_by_name: string;
}

export interface LiveInvoice {
  readonly invoice: Invoice;
  readonly balanceScaled: bigint;
}

/** An invoice's balance and paid status come only from Kill Bill. */
export async function buildInvoice(row: InvoiceRow): Promise<LiveInvoice> {
  const [lines, transfers] = await Promise.all([
    query<LineRow>(
      'select id, kind, description, quantity, unit_price from invoice_lines where invoice_id = $1 order by position',
      [row.id],
    ),
    query<TransferRow>(
      `select t.killbill_payment_id, t.reference, t.recorded_by, u.name as recorded_by_name
       from transfers t join users u on u.id = t.recorded_by where t.invoice_id = $1`,
      [row.id],
    ),
  ]);

  let balance = row.last_balance;
  let live = false;
  let payments: KbPayment[] = [];
  let paidAt = row.paid_at;
  try {
    const killBillInvoice = await readKillBillInvoice(row.killbill_invoice_id);
    payments = await readInvoicePayments(row.killbill_invoice_id);
    balance = killBillInvoice.balance;
    live = true;
    paidAt = paidThroughDate(payments, row.total, balance);
    await recordConfirmedBalance(row, balance, paidAt);
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
  }

  const status = isZero(balance) ? 'paid' : 'awaiting_payment';
  const totals = lineTotals(lines);
  const confirmedAt = live ? new Date() : row.status_confirmed_at;
  const byPaymentId = new Map(transfers.map((transfer) => [transfer.killbill_payment_id, transfer]));

  return {
    balanceScaled: parseMoney(balance) ?? 0n,
    invoice: {
      id: row.id,
      number: row.number,
      job_id: row.job_id,
      car: {
        id: row.car_id,
        name: carName({ year: row.car_year, make: row.car_make, model: row.car_model }),
      },
      owner: { id: row.owner_id, name: row.owner_name },
      lines: toLines(lines),
      net_total: totals.net_total,
      vat_total: totals.vat_total,
      rounding: totals.rounding,
      total: totals.total,
      currency: 'CHF',
      balance,
      balance_live: live,
      status,
      issued_at: row.issued_at.toISOString(),
      paid_at: status === 'paid' ? paidAt : null,
      status_confirmed_at: confirmedAt.toISOString(),
      payments: payments.map((payment) => toPayment(payment, byPaymentId.get(payment.paymentId))),
      killbill_invoice_id: row.killbill_invoice_id,
    },
  };
}

function toPayment(payment: KbPayment, transfer: TransferRow | undefined): Payment {
  return {
    killbill_payment_id: payment.paymentId,
    amount: payment.amount,
    refunded: payment.refunded,
    reference: transfer?.reference ?? null,
    at: payment.at,
    recorded_by:
      transfer === undefined
        ? null
        : { id: transfer.recorded_by, name: transfer.recorded_by_name },
  };
}

export function isZero(amount: string): boolean {
  return (parseMoney(amount) ?? 0n) <= 0n;
}

/** The Zurich date of the Kill Bill payment that brought the invoice to zero. */
function paidThroughDate(
  payments: readonly KbPayment[],
  total: string,
  balance: string,
): string | null {
  if (!isZero(balance)) return null;
  const target = parseMoney(total) ?? 0n;
  let running = 0n;
  for (const payment of payments) {
    const net = (parseMoney(payment.amount) ?? 0n) - (parseMoney(payment.refunded) ?? 0n);
    running += net;
    if (running >= target && target > 0n) return zurichDate(new Date(payment.at));
  }
  const last = payments[payments.length - 1];
  return last === undefined ? null : zurichDate(new Date(last.at));
}

/**
 * Every answer Kill Bill gives updates the stored last confirmed balance, and moves the
 * job between invoiced and paid.
 */
async function recordConfirmedBalance(
  row: InvoiceRow,
  balance: string,
  paidAt: string | null,
): Promise<void> {
  const status = isZero(balance) ? 'paid' : 'awaiting_payment';
  await query(
    `update invoices set last_balance = $2, last_status = $3, status_confirmed_at = now(), paid_at = $4
     where id = $1`,
    [row.id, balance, status, paidAt],
  );
  if (status === 'paid') {
    await query(
      "update jobs set status = 'paid', version = version + 1 where id = $1 and status = 'invoiced'",
      [row.job_id],
    );
  } else {
    await query(
      "update jobs set status = 'invoiced', version = version + 1 where id = $1 and status = 'paid'",
      [row.job_id],
    );
  }
}

export async function loadInvoiceRow(
  invoiceId: string,
  ownerId: string | null,
): Promise<InvoiceRow | null> {
  const values: QueryValue[] = [invoiceId];
  let where = 'where i.id = $1';
  if (ownerId !== null) {
    values.push(ownerId);
    where += ' and i.owner_id = $2';
  }
  const rows = await query<InvoiceRow>(`${INVOICE_SELECT} ${where}`, values);
  return rows[0] ?? null;
}

export async function loadInvoiceRows(ownerId: string | null): Promise<InvoiceRow[]> {
  const values: QueryValue[] = [];
  let where = '';
  if (ownerId !== null) {
    values.push(ownerId);
    where = 'where i.owner_id = $1';
  }
  return query<InvoiceRow>(`${INVOICE_SELECT} ${where} order by i.number`, values);
}

export interface InvoiceList {
  readonly invoices: Invoice[];
  readonly unpaidTotal: string;
  readonly live: boolean;
}

export async function buildInvoiceList(rows: readonly InvoiceRow[]): Promise<InvoiceList> {
  const built = await Promise.all(rows.map((row) => buildInvoice(row)));
  let unpaid = 0n;
  let live = true;
  for (const entry of built) {
    if (entry.balanceScaled > 0n) {
      unpaid += entry.balanceScaled;
      if (!entry.invoice.balance_live) live = false;
    }
  }
  return {
    invoices: built.map((entry) => entry.invoice),
    unpaidTotal: formatMoney(unpaid),
    live,
  };
}

/** A car is held while any invoice for that car has a balance above zero. */
export async function holdingInvoicesFor(carId: string): Promise<HoldingInvoice[]> {
  const rows = await query<InvoiceRow>(
    `${INVOICE_SELECT} where i.car_id = $1 order by i.number`,
    [carId],
  );
  const built = await Promise.all(rows.map((row) => buildInvoice(row)));
  return built
    .filter((entry) => entry.balanceScaled > 0n)
    .map((entry) => ({
      id: entry.invoice.id,
      number: entry.invoice.number,
      balance: entry.invoice.balance,
    }));
}
