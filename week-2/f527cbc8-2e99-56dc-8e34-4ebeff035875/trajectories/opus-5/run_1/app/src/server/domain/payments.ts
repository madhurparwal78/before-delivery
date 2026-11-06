import { query, queryOne, type Db } from '../db.js';
import { newId } from '../util.js';
import { illegalTransition, conflict } from '../errors.js';
import { writeAudit, type Actor } from '../audit.js';
import { chargeCard, cardLast4 } from './cards.js';
import { writeLedger } from './ledger.js';
import * as killbill from '../services/killbill.js';
import { KillBillUnavailable } from '../services/killbill.js';
import { businessDateAt } from './time.js';

/**
 * The payment state machine, the deposit lifecycle and the Kill Bill legs each payment
 * owns. A leg that cannot reach Kill Bill leaves the action successful and the payment
 * pending, under the published hold-off.
 */
export type PaymentStatus =
  | 'authorized'
  | 'captured'
  | 'partially_refunded'
  | 'refunded'
  | 'voided'
  | 'declined';

export type PaymentKind = 'deposit' | 'invoice';
export type Disposition = 'held' | 'forfeited' | 'applied' | null;
export type KillBillStatus = 'not_recorded' | 'pending' | 'recorded';

export const PENDING_HOLD_OFF_SECONDS = 20;

export interface PaymentRow {
  id: string;
  kind: PaymentKind;
  status: PaymentStatus;
  owner_id: string;
  booking_id: string | null;
  invoice_id: string | null;
  amount_cents: number;
  captured_cents: number;
  refunded_cents: number;
  applied_cents: number;
  disposition: Disposition;
  card_token: string;
  card_last4: string;
  decline_code: string | null;
  killbill_status: KillBillStatus;
  killbill_invoice_id: string | null;
  killbill_payment_id: string | null;
}

export const PAYMENT_COLUMNS = `id, kind, status, owner_id, booking_id, invoice_id, amount_cents,
  captured_cents, refunded_cents, applied_cents, disposition, card_token, card_last4,
  decline_code, killbill_status, killbill_invoice_id, killbill_payment_id`;

export async function loadPayment(db: Db, id: string, lock = false): Promise<PaymentRow | null> {
  return await queryOne<PaymentRow>(
    db,
    `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
}

/** The refundable amount is what was captured, less what is refunded and what is applied. */
export function refundableCents(payment: PaymentRow): number {
  return payment.captured_cents - payment.refunded_cents - payment.applied_cents;
}

const REFUNDABLE_FROM: readonly PaymentStatus[] = ['captured', 'partially_refunded'];

export function assertCanRefund(payment: PaymentRow): void {
  if (!REFUNDABLE_FROM.includes(payment.status)) {
    throw illegalTransition(payment.status, 'refund');
  }
}

export interface AuthoriseInput {
  kind: PaymentKind;
  ownerId: string;
  bookingId?: string | null;
  invoiceId?: string | null;
  amountCents: number;
  cardToken: string;
  actor: Actor;
  requestId: string | null;
  at: Date;
}

export interface AuthoriseResult {
  payment: PaymentRow;
  approved: boolean;
  declineCode: string | null;
}

/** Authorises on the card. A decline stores one `declined` payment row and nothing else. */
export async function authorisePayment(db: Db, input: AuthoriseInput): Promise<AuthoriseResult> {
  const outcome = chargeCard(input.cardToken);
  const id = newId();
  const status: PaymentStatus = outcome.approved ? 'authorized' : 'declined';
  await query(
    db,
    `INSERT INTO payments (id, kind, status, owner_id, booking_id, invoice_id, amount_cents,
                           card_token, card_last4, decline_code, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      input.kind,
      status,
      input.ownerId,
      input.bookingId ?? null,
      input.invoiceId ?? null,
      input.amountCents,
      input.cardToken,
      outcome.last4,
      outcome.declineCode,
      input.at,
    ],
  );
  await writeAudit(db, {
    actor: input.actor,
    action: outcome.approved ? 'authorize' : 'decline',
    entityType: 'payment',
    entityId: id,
    to: status,
    at: input.at,
    requestId: input.requestId,
  });
  const payment = await loadPayment(db, id);
  if (payment === null) throw new Error('payment row vanished');
  return { payment, approved: outcome.approved, declineCode: outcome.declineCode };
}

async function markKillBillPending(db: Db, paymentId: string, at: Date): Promise<void> {
  await query(
    db,
    `UPDATE payments SET killbill_status = 'pending', pending_since = COALESCE(pending_since,$2),
                         next_attempt_at = COALESCE(next_attempt_at,$3)
     WHERE id = $1`,
    [paymentId, at, new Date(at.getTime() + PENDING_HOLD_OFF_SECONDS * 1000)],
  );
}

export interface OwnerIdentity {
  email: string;
  name: string;
}

/**
 * Records a captured deposit in Kill Bill: a deposit invoice with one external charge
 * and one external payment keyed `<payment id>:capture`.
 */
export async function recordDepositCaptureInKillBill(
  db: Db,
  payment: PaymentRow,
  owner: OwnerIdentity,
  horseName: string,
  businessDate: string,
  at: Date,
): Promise<boolean> {
  const marker = `[${payment.id}]`;
  try {
    const accountId = await killbill.ensureAccount(owner.email, owner.name);
    const existing = await killbill.findInvoiceByMarker(accountId, marker);
    const invoice =
      existing ??
      (await killbill.createCharges(accountId, [
        {
          description: `Booking deposit — ${horseName} ${businessDate} ${marker}`,
          amountCents: payment.captured_cents,
        },
      ]));
    const kbPayment = await killbill.createExternalPayment(
      accountId,
      invoice.invoiceId,
      payment.captured_cents,
      `${payment.id}:capture`,
    );
    await query(
      db,
      `UPDATE payments SET killbill_status = 'recorded', killbill_invoice_id = $2,
                           killbill_payment_id = $3, pending_since = NULL, next_attempt_at = NULL
       WHERE id = $1`,
      [payment.id, invoice.invoiceId, kbPayment.paymentId],
    );
    return true;
  } catch (error) {
    if (!(error instanceof KillBillUnavailable)) throw error;
    await markKillBillPending(db, payment.id, at);
    return false;
  }
}

export interface CaptureInput {
  payment: PaymentRow;
  owner: OwnerIdentity;
  horseId: string;
  horseName: string;
  businessDate: string;
  disposition: Disposition;
  actor: Actor;
  requestId: string | null;
  at: Date;
  timeZone: string;
}

/** Captures a deposit, writes its ledger entry and records it in Kill Bill. */
export async function captureDeposit(db: Db, input: CaptureInput): Promise<PaymentRow> {
  if (input.payment.status !== 'authorized') {
    throw illegalTransition(input.payment.status, 'capture');
  }
  await query(
    db,
    `UPDATE payments SET status = 'captured', captured_cents = amount_cents, disposition = $2
     WHERE id = $1`,
    [input.payment.id, input.disposition],
  );
  await writeAudit(db, {
    actor: input.actor,
    action: 'capture',
    entityType: 'payment',
    entityId: input.payment.id,
    from: input.payment.status,
    to: 'captured',
    at: input.at,
    requestId: input.requestId,
  });
  const captured = await loadPayment(db, input.payment.id);
  if (captured === null) throw new Error('payment row vanished');

  await writeLedger(db, {
    kind: 'deposit_captured',
    amountCents: captured.captured_cents,
    at: input.at,
    ownerId: captured.owner_id,
    horseId: input.horseId,
    businessDate: businessDateAt(input.at, input.timeZone),
    paymentId: captured.id,
  });
  await recordDepositCaptureInKillBill(
    db,
    captured,
    input.owner,
    input.horseName,
    input.businessDate,
    input.at,
  );
  return (await loadPayment(db, captured.id)) as PaymentRow;
}

export async function voidPayment(
  db: Db,
  payment: PaymentRow,
  actor: Actor,
  requestId: string | null,
  at: Date,
): Promise<void> {
  if (payment.status !== 'authorized') throw illegalTransition(payment.status, 'void');
  await query(db, `UPDATE payments SET status = 'voided' WHERE id = $1`, [payment.id]);
  await writeAudit(db, {
    actor,
    action: 'void',
    entityType: 'payment',
    entityId: payment.id,
    from: payment.status,
    to: 'voided',
    at,
    requestId,
  });
}

export interface RefundInput {
  payment: PaymentRow;
  amountCents: number;
  reason: string;
  owner: OwnerIdentity;
  horseId: string;
  actor: Actor;
  requestId: string | null;
  /** One stored decision instant settles the refund and its ledger entry. */
  at: Date;
  timeZone: string;
}

/**
 * Refunds part or all of a captured payment: one refund row, one Kill Bill CREDIT
 * transaction carrying the refund id, and one refund ledger entry beside the untouched
 * capture entry.
 */
export async function refundPayment(db: Db, input: RefundInput): Promise<PaymentRow> {
  assertCanRefund(input.payment);
  const refundable = refundableCents(input.payment);
  if (input.amountCents > refundable) {
    throw conflict('refund_exceeds_captured', { refundable_cents: refundable });
  }
  const refundId = newId();
  await query(
    db,
    `INSERT INTO refunds (id, payment_id, amount_cents, reason, killbill_key, killbill_status, at, created_at)
     VALUES ($1,$2,$3,$4,$1,'not_recorded',$5,$5)`,
    [refundId, input.payment.id, input.amountCents, input.reason, input.at],
  );
  const refundedTotal = input.payment.refunded_cents + input.amountCents;
  const remaining = input.payment.captured_cents - refundedTotal - input.payment.applied_cents;
  const status: PaymentStatus = remaining <= 0 ? 'refunded' : 'partially_refunded';
  await query(
    db,
    `UPDATE payments SET refunded_cents = $2, status = $3,
                         disposition = CASE WHEN $3 = 'refunded' AND kind = 'deposit' AND disposition <> 'applied'
                                            THEN NULL ELSE disposition END
     WHERE id = $1`,
    [input.payment.id, refundedTotal, status],
  );
  await writeAudit(db, {
    actor: input.actor,
    action: 'refund',
    entityType: 'payment',
    entityId: input.payment.id,
    from: input.payment.status,
    to: status,
    at: input.at,
    requestId: input.requestId,
  });
  await writeLedger(db, {
    kind: 'refund',
    amountCents: input.amountCents,
    at: input.at,
    ownerId: input.payment.owner_id,
    horseId: input.horseId,
    businessDate: businessDateAt(input.at, input.timeZone),
    paymentId: input.payment.id,
    refundId,
    invoiceId: input.payment.invoice_id,
  });

  await recordRefundInKillBill(db, input.payment, refundId, input.amountCents, input.owner, input.at);
  return (await loadPayment(db, input.payment.id)) as PaymentRow;
}

export async function recordRefundInKillBill(
  db: Db,
  payment: PaymentRow,
  refundId: string,
  amountCents: number,
  owner: OwnerIdentity,
  at: Date,
): Promise<boolean> {
  try {
    const accountId = await killbill.ensureAccount(owner.email, owner.name);
    const killbillPaymentId =
      payment.killbill_payment_id ??
      (await killbill.findPaymentByExternalKey(`${payment.id}:capture`))?.paymentId ??
      null;
    if (killbillPaymentId === null) {
      await markKillBillPending(db, payment.id, at);
      await query(db, `UPDATE refunds SET killbill_status = 'pending' WHERE id = $1`, [refundId]);
      return false;
    }
    const adjustments: { invoiceItemId: string; amountCents: number }[] = [];
    if (payment.killbill_invoice_id !== null) {
      const invoice = await killbill.readInvoice(payment.killbill_invoice_id);
      const item = invoice?.items.find((candidate) => candidate.description.includes(`[${payment.id}]`));
      if (item !== undefined) adjustments.push({ invoiceItemId: item.invoiceItemId, amountCents });
    }
    await killbill.createRefund(accountId, killbillPaymentId, amountCents, refundId, adjustments);
    await query(db, `UPDATE refunds SET killbill_status = 'recorded' WHERE id = $1`, [refundId]);
    return true;
  } catch (error) {
    if (!(error instanceof KillBillUnavailable)) throw error;
    await markKillBillPending(db, payment.id, at);
    await query(db, `UPDATE refunds SET killbill_status = 'pending' WHERE id = $1`, [refundId]);
    return false;
  }
}

/** Forfeits a kept deposit: the money stays with the practice and remains collected. */
export async function forfeitDeposit(
  db: Db,
  payment: PaymentRow,
  actor: Actor,
  requestId: string | null,
  at: Date,
): Promise<void> {
  await query(db, `UPDATE payments SET disposition = 'forfeited' WHERE id = $1`, [payment.id]);
  await writeAudit(db, {
    actor,
    action: 'forfeit',
    entityType: 'payment',
    entityId: payment.id,
    from: payment.status,
    to: payment.status,
    at,
    requestId,
  });
}

export async function depositPaymentForBooking(db: Db, bookingId: string): Promise<PaymentRow | null> {
  return await queryOne<PaymentRow>(
    db,
    `SELECT ${PAYMENT_COLUMNS} FROM payments
     WHERE booking_id = $1 AND kind = 'deposit' AND status <> 'declined'
     ORDER BY created_at DESC LIMIT 1`,
    [bookingId],
  );
}

/** The latest published token an owner submits becomes their card on file. */
export async function setCardOnFile(db: Db, ownerId: string, cardToken: string): Promise<string> {
  const last4 = cardLast4(cardToken);
  await query(db, 'UPDATE users SET card_token = $2, card_last4 = $3 WHERE id = $1', [
    ownerId,
    cardToken,
    last4,
  ]);
  return last4;
}

export async function cardOnFile(db: Db, ownerId: string): Promise<string | null> {
  const row = await queryOne<{ card_token: string | null }>(
    db,
    'SELECT card_token FROM users WHERE id = $1',
    [ownerId],
  );
  return row?.card_token ?? null;
}

export function paymentJson(payment: PaymentRow): Record<string, unknown> {
  return {
    id: payment.id,
    kind: payment.kind,
    status: payment.status,
    amount_cents: payment.amount_cents,
    captured_cents: payment.captured_cents,
    refunded_cents: payment.refunded_cents,
    applied_cents: payment.applied_cents,
    disposition: payment.disposition,
    booking_id: payment.booking_id,
    invoice_id: payment.invoice_id,
    card_last4: payment.card_last4,
    decline_code: payment.decline_code,
    killbill_status: payment.killbill_status,
  };
}

export function pendingRetryInstant(at: Date): Date {
  return new Date(at.getTime() + PENDING_HOLD_OFF_SECONDS * 1000);
}

