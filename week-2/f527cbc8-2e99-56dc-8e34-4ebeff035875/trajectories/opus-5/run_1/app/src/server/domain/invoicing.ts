import { config } from '../config.js';
import { now } from '../clock.js';
import { query, queryOne, withTransaction, type Db } from '../db.js';
import { newId, dollars } from '../util.js';
import { log } from '../log.js';
import { writeAudit, type Actor } from '../audit.js';
import { queueBackgroundEmail, queueRequestEmail, type QueuedEmail } from '../services/mail.js';
import { outstandingAlertEmail, visitSummaryEmail } from '../services/emails.js';
import * as killbill from '../services/killbill.js';
import { KillBillUnavailable } from '../services/killbill.js';
import { writeLedger, hasLedgerEntry } from './ledger.js';
import {
  PENDING_HOLD_OFF_SECONDS,
  loadPayment,
  recordRefundInKillBill,
  type PaymentRow,
} from './payments.js';
import { businessDateAt } from './time.js';
import { nextDue } from './nextdue.js';
import { practice } from './practice.js';

/**
 * Invoices and the Kill Bill legs they own. Each invoice is created in Kill Bill
 * exactly once: the charges are found by the marker their descriptions carry, and the
 * deposit credit moves as one paired refund and payment keyed to the invoice.
 */
export type InvoiceKind = 'visit' | 'trip' | 'deposit';
export type InvoiceStatus = 'pending' | 'unpaid' | 'paid';
export type DunningState = 'none' | 'past_due' | 'retry_1' | 'retry_2' | 'blocked' | 'cleared';
export type Reconciliation = 'unchecked' | 'matched' | 'mismatch' | 'unavailable';

export interface InvoiceItem {
  description: string;
  amount_cents: number;
}

export interface InvoiceRow {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  owner_id: string;
  horse_id: string;
  horse_name: string;
  visit_id: string | null;
  booking_id: string | null;
  barn_day_id: string | null;
  business_date: string;
  items: InvoiceItem[];
  total_cents: number;
  balance_cents: number;
  killbill_invoice_id: string | null;
  killbill_charges_done: boolean;
  deposit_transfer_done: boolean;
  dunning_state: DunningState;
  first_declined_at: Date | null;
  reconciliation: Reconciliation;
  pending_since: Date | null;
}

export const INVOICE_COLUMNS = `i.id, i.kind, i.status, i.owner_id, i.horse_id, h.name AS horse_name,
  i.visit_id, i.booking_id, i.barn_day_id, to_char(i.business_date,'YYYY-MM-DD') AS business_date,
  i.items, i.total_cents, i.balance_cents, i.killbill_invoice_id, i.killbill_charges_done,
  i.deposit_transfer_done, i.dunning_state, i.first_declined_at, i.reconciliation, i.pending_since`;

export async function loadInvoice(db: Db, id: string, lock = false): Promise<InvoiceRow | null> {
  if (lock) {
    const locked = await queryOne<{ id: string }>(
      db,
      'SELECT id FROM invoices WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (locked === null) return null;
  }
  return await queryOne<InvoiceRow>(
    db,
    `SELECT ${INVOICE_COLUMNS} FROM invoices i JOIN horses h ON h.id = i.horse_id WHERE i.id = $1`,
    [id],
  );
}

export function invoiceJson(invoice: InvoiceRow): Record<string, unknown> {
  return {
    id: invoice.id,
    kind: invoice.kind,
    status: invoice.status,
    horse: { id: invoice.horse_id, name: invoice.horse_name },
    business_date: invoice.business_date,
    items: invoice.items,
    total_cents: invoice.total_cents,
    balance_cents: invoice.balance_cents,
    killbill_invoice_id: invoice.killbill_invoice_id,
    dunning_state: invoice.dunning_state,
    reconciliation: invoice.reconciliation,
  };
}

export function grossOf(items: readonly InvoiceItem[]): number {
  return items
    .filter((item) => item.amount_cents > 0)
    .reduce((sum, item) => sum + item.amount_cents, 0);
}

export interface CreateInvoiceInput {
  kind: 'visit' | 'trip';
  ownerId: string;
  horseId: string;
  visitId: string | null;
  bookingId: string | null;
  barnDayId: string | null;
  businessDate: string;
  items: InvoiceItem[];
  actor: Actor;
  requestId: string | null;
  at: Date;
}

export async function createInvoiceRow(db: Db, input: CreateInvoiceInput): Promise<InvoiceRow> {
  const total = input.items.reduce((sum, item) => sum + item.amount_cents, 0);
  const id = newId();
  await query(
    db,
    `INSERT INTO invoices (id, kind, status, owner_id, horse_id, visit_id, booking_id, barn_day_id,
                           business_date, items, total_cents, balance_cents, created_at)
     VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10,$11)`,
    [
      id,
      input.kind,
      input.ownerId,
      input.horseId,
      input.visitId,
      input.bookingId,
      input.barnDayId,
      input.businessDate,
      JSON.stringify(input.items),
      total,
      input.at,
    ],
  );
  await writeAudit(db, {
    actor: input.actor,
    action: 'create',
    entityType: 'invoice',
    entityId: id,
    to: 'pending',
    at: input.at,
    requestId: input.requestId,
  });
  const invoice = await loadInvoice(db, id);
  if (invoice === null) throw new Error('invoice row vanished');
  return invoice;
}

/** The deposit left on a booking to set against its invoice. */
export function depositCreditCents(payment: PaymentRow | null, grossCents: number): number {
  if (payment === null) return 0;
  const remaining = payment.captured_cents - payment.refunded_cents - payment.applied_cents;
  if (remaining <= 0) return 0;
  return Math.min(remaining, grossCents);
}

async function markPending(db: Db, invoiceId: string, at: Date): Promise<void> {
  await query(
    db,
    `UPDATE invoices SET status = 'pending',
                         pending_since = COALESCE(pending_since, $2),
                         next_attempt_at = COALESCE(next_attempt_at, $3)
     WHERE id = $1 AND status = 'pending'`,
    [invoiceId, at, new Date(at.getTime() + PENDING_HOLD_OFF_SECONDS * 1000)],
  );
  await query(
    db,
    `UPDATE visits SET status = 'invoice_pending' WHERE id = (SELECT visit_id FROM invoices WHERE id = $1)
       AND status IN ('closed','invoice_pending')`,
    [invoiceId],
  );
}

export interface FinishOptions {
  queueKind: 'request' | 'background';
  actor: Actor;
  requestId: string | null;
}

/**
 * Pushes an invoice's remaining legs into Kill Bill. Every step adopts what already
 * exists, so a crash, a takeover or a retry still leaves one invoice, one transfer, one
 * ledger set and one summary email.
 */
export async function finishInvoiceInKillBill(
  invoiceId: string,
  options: FinishOptions,
): Promise<'invoiced' | 'pending' | 'skipped'> {
  const instant = now();
  const claimed = await withTransaction(async (db) => {
    const row = await queryOne<{ id: string }>(
      db,
      `UPDATE invoices SET lease_expires_at = $2
       WHERE id = $1 AND status = 'pending'
         AND (lease_expires_at IS NULL OR lease_expires_at <= $3)
       RETURNING id`,
      [invoiceId, new Date(instant.getTime() + config.jobLeaseSeconds * 1000), instant],
    );
    return row !== null;
  });
  if (!claimed) return 'skipped';

  try {
    const outcome = await withTransaction(async (db) => {
      const invoice = await loadInvoice(db, invoiceId, true);
      if (invoice === null || invoice.status !== 'pending') return 'skipped' as const;
      const owner = await queryOne<{ email: string; name: string }>(
        db,
        'SELECT email, name FROM users WHERE id = $1',
        [invoice.owner_id],
      );
      if (owner === null) throw new Error('invoice owner vanished');
      const { timeZone } = await practice(db);

      const gross = grossOf(invoice.items);
      const marker = `[${invoice.id}]`;
      const accountId = await killbill.ensureAccount(owner.email, owner.name);

      let killbillInvoiceId = invoice.killbill_invoice_id;
      if (!invoice.killbill_charges_done) {
        const existing = await killbill.findInvoiceByMarker(accountId, marker);
        const created =
          existing ??
          (await killbill.createCharges(
            accountId,
            invoice.items
              .filter((item) => item.amount_cents > 0)
              .map((item) => ({
                description: `${item.description} ${marker}`,
                amountCents: item.amount_cents,
              })),
          ));
        killbillInvoiceId = created.invoiceId;
        await query(
          db,
          `UPDATE invoices SET killbill_invoice_id = $2, killbill_charges_done = true WHERE id = $1`,
          [invoice.id, killbillInvoiceId],
        );
        if (!(await hasLedgerEntry(db, 'billed', { invoiceId: invoice.id }))) {
          await writeLedger(db, {
            kind: 'billed',
            amountCents: gross,
            at: instant,
            ownerId: invoice.owner_id,
            horseId: invoice.horse_id,
            businessDate: businessDateAt(instant, timeZone),
            invoiceId: invoice.id,
          });
        }
      }
      if (killbillInvoiceId === null) throw new Error('invoice has no Kill Bill id');

      if (!invoice.deposit_transfer_done) {
        await moveDepositCredit(db, invoice, killbillInvoiceId, accountId, owner, instant, timeZone);
      }

      const balance = invoice.total_cents <= 0 ? 0 : invoice.total_cents;
      const paid = invoice.total_cents <= 0;
      await query(
        db,
        `UPDATE invoices SET status = $2, balance_cents = $3, pending_since = NULL,
                             next_attempt_at = NULL
         WHERE id = $1`,
        [invoice.id, paid ? 'paid' : 'unpaid', paid ? 0 : balance],
      );
      await writeAudit(db, {
        actor: options.actor,
        action: 'invoice',
        entityType: 'invoice',
        entityId: invoice.id,
        from: 'pending',
        to: paid ? 'paid' : 'unpaid',
        at: instant,
        requestId: options.requestId,
      });

      if (invoice.visit_id !== null) {
        await query(db, `UPDATE visits SET status = 'invoiced' WHERE id = $1`, [invoice.visit_id]);
        await writeAudit(db, {
          actor: options.actor,
          action: 'invoiced',
          entityType: 'visit',
          entityId: invoice.visit_id,
          to: 'invoiced',
          at: instant,
          requestId: options.requestId,
        });
      }

      await queueSummaryEmail(db, invoice, owner.email, options.queueKind);
      await checkOutstandingAlert(db, instant, options.queueKind);
      return 'invoiced' as const;
    });
    return outcome;
  } catch (error) {
    if (!(error instanceof KillBillUnavailable)) throw error;
    await withTransaction((db) => markPending(db, invoiceId, instant));
    log.event({ event: 'invoice_pending', invoice_id: invoiceId });
    return 'pending';
  } finally {
    await withTransaction((db) =>
      query(db, 'UPDATE invoices SET lease_expires_at = NULL WHERE id = $1', [invoiceId]),
    );
  }
}

/**
 * The deposit credit moves as one transfer of two legs — a refund on the deposit
 * payment and an external payment on the new invoice. Account credit is never used,
 * because it would drift onto a sibling horse's invoice.
 */
async function moveDepositCredit(
  db: Db,
  invoice: InvoiceRow,
  killbillInvoiceId: string,
  accountId: string,
  owner: { email: string; name: string },
  at: Date,
  timeZone: string,
): Promise<void> {
  const creditItem = invoice.items.find((item) => item.amount_cents < 0);
  if (creditItem === undefined || invoice.booking_id === null) {
    await query(db, 'UPDATE invoices SET deposit_transfer_done = true WHERE id = $1', [invoice.id]);
    return;
  }
  const creditCents = Math.abs(creditItem.amount_cents);
  const deposit = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM payments WHERE booking_id = $1 AND kind = 'deposit'
       AND status IN ('captured','partially_refunded') ORDER BY created_at DESC LIMIT 1`,
    [invoice.booking_id],
  );
  if (deposit === null) {
    await query(db, 'UPDATE invoices SET deposit_transfer_done = true WHERE id = $1', [invoice.id]);
    return;
  }
  const payment = await loadPayment(db, deposit.id, true);
  if (payment === null) return;

  const killbillPaymentId =
    payment.killbill_payment_id ??
    (await killbill.findPaymentByExternalKey(`${payment.id}:capture`))?.paymentId ??
    null;
  if (killbillPaymentId === null) throw new KillBillUnavailable('deposit capture is not in billing');

  const adjustments: { invoiceItemId: string; amountCents: number }[] = [];
  if (payment.killbill_invoice_id !== null) {
    const depositInvoice = await killbill.readInvoice(payment.killbill_invoice_id);
    const item = depositInvoice?.items.find((candidate) =>
      candidate.description.includes(`[${payment.id}]`),
    );
    if (item !== undefined) adjustments.push({ invoiceItemId: item.invoiceItemId, amountCents: creditCents });
  }
  await killbill.createRefund(
    accountId,
    killbillPaymentId,
    creditCents,
    `${invoice.id}:deposit-out`,
    adjustments,
  );
  await killbill.createExternalPayment(
    accountId,
    killbillInvoiceId,
    creditCents,
    `${invoice.id}:deposit-in`,
  );

  // Trip-only invoices keep a forfeited deposit's disposition; visit invoices apply it.
  await query(
    db,
    `UPDATE payments SET applied_cents = applied_cents + $2,
                         disposition = CASE WHEN disposition = 'forfeited' THEN 'forfeited' ELSE 'applied' END
     WHERE id = $1`,
    [payment.id, creditCents],
  );
  await query(db, 'UPDATE invoices SET deposit_transfer_done = true WHERE id = $1', [invoice.id]);

  const businessDate = businessDateAt(at, timeZone);
  if (!(await hasLedgerEntry(db, 'deposit_transfer_out', { invoiceId: invoice.id }))) {
    await writeLedger(db, {
      kind: 'deposit_transfer_out',
      amountCents: creditCents,
      at,
      ownerId: invoice.owner_id,
      horseId: invoice.horse_id,
      businessDate,
      invoiceId: invoice.id,
      paymentId: payment.id,
    });
    await writeLedger(db, {
      kind: 'deposit_transfer_in',
      amountCents: creditCents,
      at,
      ownerId: invoice.owner_id,
      horseId: invoice.horse_id,
      businessDate,
      invoiceId: invoice.id,
      paymentId: payment.id,
    });
  }

  // Any part of a visit deposit above the gross is refunded to the owner.
  const refreshed = await loadPayment(db, payment.id, true);
  if (refreshed !== null && invoice.kind === 'visit') {
    const excess = refreshed.captured_cents - refreshed.refunded_cents - refreshed.applied_cents;
    if (excess > 0) {
      const refundId = newId();
      await query(
        db,
        `INSERT INTO refunds (id, payment_id, amount_cents, reason, killbill_key, killbill_status, at, created_at)
         VALUES ($1,$2,$3,'deposit_excess',$1,'not_recorded',$4,$4)`,
        [refundId, refreshed.id, excess, at],
      );
      await query(
        db,
        `UPDATE payments SET refunded_cents = refunded_cents + $2, status = 'partially_refunded'
         WHERE id = $1`,
        [refreshed.id, excess],
      );
      await writeLedger(db, {
        kind: 'refund',
        amountCents: excess,
        at,
        ownerId: invoice.owner_id,
        horseId: invoice.horse_id,
        businessDate,
        paymentId: refreshed.id,
        refundId,
        invoiceId: invoice.id,
      });
      await recordRefundInKillBill(db, refreshed, refundId, excess, owner, at);
    }
  }
}

async function queueSummaryEmail(
  db: Db,
  invoice: InvoiceRow,
  ownerEmail: string,
  queueKind: 'request' | 'background',
): Promise<void> {
  if (invoice.kind !== 'visit') return;
  const horse = await queryOne<{ name: string; cycle_weeks: number }>(
    db,
    'SELECT name, cycle_weeks FROM horses WHERE id = $1',
    [invoice.horse_id],
  );
  if (horse === null) return;
  const last = await queryOne<{ business_date: string }>(
    db,
    `SELECT to_char(business_date,'YYYY-MM-DD') AS business_date FROM visits
     WHERE horse_id = $1 AND status <> 'open' ORDER BY business_date DESC LIMIT 1`,
    [invoice.horse_id],
  );
  const due = nextDue(last?.business_date ?? null, horse.cycle_weeks, invoice.business_date);
  const message = visitSummaryEmail(
    horse.name,
    invoice.business_date,
    invoice.items,
    invoice.total_cents,
    due.nextDueDate,
  );
  const email: QueuedEmail = {
    to: ownerEmail,
    subject: message.subject,
    body: message.body,
    dedupeKey: `visit_summary:${invoice.id}`,
  };
  if (queueKind === 'request') await queueRequestEmail(db, email);
  else await queueBackgroundEmail(db, email);
}

/**
 * The outstanding-balance alert. It fires once when the sum of unpaid balances crosses
 * above the threshold and re-arms only after falling back to or below it. The armed
 * state lives in Postgres per threshold value.
 */
export async function checkOutstandingAlert(
  db: Db,
  at: Date,
  queueKind: 'request' | 'background',
): Promise<void> {
  const threshold = config.alertOutstandingCents;
  const row = await queryOne<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(balance_cents),0)::int AS total FROM invoices WHERE status = 'unpaid'`,
  );
  const total = row?.total ?? 0;

  await query(
    db,
    `INSERT INTO alert_states (threshold_cents, armed) VALUES ($1,true)
     ON CONFLICT (threshold_cents) DO NOTHING`,
    [threshold],
  );
  const state = await queryOne<{ armed: boolean }>(
    db,
    'SELECT armed FROM alert_states WHERE threshold_cents = $1 FOR UPDATE',
    [threshold],
  );
  if (state === null) return;

  if (total > threshold && state.armed) {
    await query(db, 'UPDATE alert_states SET armed = false WHERE threshold_cents = $1', [threshold]);
    const farrier = await queryOne<{ email: string }>(
      db,
      `SELECT email FROM users WHERE role = 'farrier' ORDER BY created_at LIMIT 1`,
    );
    if (farrier !== null) {
      const message = outstandingAlertEmail(threshold);
      const email: QueuedEmail = {
        to: farrier.email,
        subject: message.subject,
        body: message.body,
        dedupeKey: `outstanding_alert:${threshold}:${at.getTime()}`,
      };
      if (queueKind === 'request') await queueRequestEmail(db, email);
      else await queueBackgroundEmail(db, email);
    }
  } else if (total <= threshold && !state.armed) {
    await query(db, 'UPDATE alert_states SET armed = true WHERE threshold_cents = $1', [threshold]);
  }
}

export function depositCreditDescription(horseName: string, businessDate: string): string {
  return `Deposit credit — ${horseName} ${businessDate}`;
}

export function tripShareDescription(barnName: string, businessDate: string): string {
  return `Trip share — ${barnName} ${businessDate}`;
}

export function tripOnlyDescription(
  barnName: string,
  businessDate: string,
  horseName: string,
  reason: 'cancelled late' | 'no-show',
): string {
  return `Trip share — ${barnName} ${businessDate} (${horseName}, ${reason})`;
}

/** Invoices whose legs are due another attempt, after the published hold-off. */
export async function pendingInvoiceIds(db: Db, at: Date): Promise<string[]> {
  const rows = await query<{ id: string }>(
    db,
    `SELECT id FROM invoices
     WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
       AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
     ORDER BY created_at LIMIT 25`,
    [at],
  );
  return rows.map((row) => row.id);
}

export function invoiceTotalText(cents: number): string {
  return dollars(cents);
}

