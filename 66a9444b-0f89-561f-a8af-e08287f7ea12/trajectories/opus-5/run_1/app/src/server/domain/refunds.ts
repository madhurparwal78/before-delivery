import { many, one, type Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';
import { formatEuros } from '../lib/money.js';
import * as killbill from '../services/killbill.js';
import { PaymentUnavailable } from '../services/killbill.js';
import { queueMail } from '../services/mail.js';
import { creditNoteNumber, loadInvoiceByOrder } from './invoices.js';
import { loadOrder, orderLines, type LineRow, type OrderRow } from './orders.js';
import { recordPayment } from './payments.js';
import { offerFreedSeats } from './seats.js';
import { recordMovement } from './vouchers.js';

export interface RefundRow {
  id: string;
  order_id: string;
  line_ids: string[];
  card_cents: number;
  voucher_cents: number;
  credit_note_id: string | null;
  status: 'pending' | 'completed';
  reason: string;
  created_at: Date;
}

export async function loadRefund(db: Queryable, id: string): Promise<RefundRow | null> {
  return one<RefundRow>(
    db,
    `SELECT id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason,
            created_at
     FROM refunds WHERE id = $1`,
    [id],
  );
}

export async function listRefunds(db: Queryable, status: string | null): Promise<RefundRow[]> {
  if (status === null) {
    return many<RefundRow>(
      db,
      `SELECT id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason,
              created_at
       FROM refunds ORDER BY created_at DESC`,
    );
  }
  return many<RefundRow>(
    db,
    `SELECT id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason,
            created_at
     FROM refunds WHERE status = $1 ORDER BY created_at DESC`,
    [status],
  );
}

export function lineRefundable(line: LineRow): boolean {
  return line.state === 'captured' || line.state === 'transferred';
}

/**
 * Returns exactly the affected lines of one order: card share to Kill Bill or a credit note, and
 * voucher share back to the same voucher.
 */
export async function refundOrderLines(
  db: Queryable,
  order: OrderRow,
  affected: readonly LineRow[],
  reason: string,
  actor: string,
): Promise<RefundRow> {
  const refundId = newId();
  const soldLines = affected.filter(lineRefundable);
  const pendingLines = affected.filter((line) => line.state === 'proof_pending');
  const cardCents = soldLines.reduce((sum, line) => sum + line.charged_cents, 0);
  const voucherCents = affected.reduce((sum, line) => sum + line.voucher_cents, 0);

  await db.query(
    `INSERT INTO refunds (id, order_id, line_ids, card_cents, voucher_cents, status, reason)
     VALUES ($1, $2, $3::uuid[], $4, $5, 'pending', $6)`,
    [refundId, order.id, affected.map((line) => line.id), cardCents, voucherCents, reason],
  );

  if (soldLines.length > 0) {
    await db.query(`UPDATE order_lines SET state = 'refunded' WHERE id = ANY($1::uuid[])`, [
      soldLines.map((line) => line.id),
    ]);
    await db.query(
      `UPDATE passes SET status = 'refunded' WHERE line_id = ANY($1::uuid[])
       AND status IN ('valid', 'transferred')`,
      [soldLines.map((line) => line.id)],
    );
  }

  if (pendingLines.length > 0) {
    await db.query(`UPDATE order_lines SET state = 'voided' WHERE id = ANY($1::uuid[])`, [
      pendingLines.map((line) => line.id),
    ]);
    const stillPending = await one<{ count: number }>(
      db,
      `SELECT COUNT(*)::int AS count FROM order_lines
       WHERE order_id = $1 AND state = 'proof_pending'`,
      [order.id],
    );
    if ((stillPending?.count ?? 0) === 0 && order.killbill_payment_id !== null) {
      const voided = await killbill.voidPayment(order.killbill_payment_id, order.ref);
      await recordPayment(db, { orderId: order.id, transaction: voided });
    }
  }

  if (order.voucher_code !== null && voucherCents > 0) {
    await recordMovement(db, {
      kind: 'return',
      code: order.voucher_code,
      amountCents: voucherCents,
      actor,
      orderRef: order.ref,
    });
  }

  await freeSeats(db, affected);

  let creditNoteId: string | null = null;
  let completed = true;
  if (cardCents > 0) {
    if (order.organisation_id !== null) {
      creditNoteId = await issueCreditNote(db, order, soldLines, refundId);
      completed = await applyCreditNoteAdjustments(db, creditNoteId);
    } else {
      completed = await sendCardRefund(db, order, refundId, cardCents);
    }
  }

  await db.query(`UPDATE refunds SET status = $2, credit_note_id = $3 WHERE id = $1`, [
    refundId,
    completed ? 'completed' : 'pending',
    creditNoteId,
  ]);

  if (order.organisation_id === null) {
    await queueMail(db, {
      eventKey: `refund:${refundId}`,
      to: order.buyer_email,
      subject: `Refund for order ${order.ref}`,
      body: [
        `We have refunded part of order ${order.ref}.`,
        '',
        ...affected.map((line) => `${line.title} — ${line.holder_name}`),
        '',
        `Card refund: ${formatEuros(cardCents)}`,
        `Returned to your gift voucher: ${formatEuros(voucherCents)}`,
      ].join('\n'),
    });
  }

  const row = await loadRefund(db, refundId);
  if (row === null) throw new Error('refund insert failed');
  return row;
}

async function sendCardRefund(
  db: Queryable,
  order: OrderRow,
  refundId: string,
  cardCents: number,
): Promise<boolean> {
  if (order.killbill_payment_id === null) return true;
  try {
    const transaction = await killbill.refund(order.killbill_payment_id, refundId, cardCents);
    await recordPayment(db, { orderId: order.id, refundId, transaction });
    return true;
  } catch (error) {
    if (error instanceof PaymentUnavailable) return false;
    throw error;
  }
}

async function issueCreditNote(
  db: Queryable,
  order: OrderRow,
  lines: readonly LineRow[],
  refundId: string,
): Promise<string> {
  const invoice = await loadInvoiceByOrder(db, order.id);
  if (invoice === null) throw new Error('group order has no invoice');
  const noteId = newId();
  const number = await creditNoteNumber(db);
  const amount = lines.reduce((sum, line) => sum + line.charged_cents, 0);
  await db.query(
    `INSERT INTO credit_notes (id, number, invoice_id, refund_id, amount_cents, issued_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [noteId, number, invoice.id, refundId, amount],
  );
  for (const line of lines) {
    await db.query(
      `INSERT INTO credit_note_lines (id, credit_note_id, line_id, description, amount_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        newId(),
        noteId,
        line.id,
        `${order.ref} \u00b7 ${line.title} \u00b7 ${line.holder_name}`,
        line.charged_cents,
      ],
    );
  }
  await queueMail(db, {
    eventKey: `credit-note:${noteId}`,
    to: order.buyer_email,
    subject: `Credit note ${number} from Kerf Collective`,
    body: [
      `Credit note ${number} against invoice ${invoice.number}.`,
      '',
      ...lines.map((line) => `${line.title} — ${line.holder_name} — ${formatEuros(line.charged_cents)}`),
      '',
      `Total credited: ${formatEuros(amount)}`,
    ].join('\n'),
  });
  return noteId;
}

/** One Kill Bill item adjustment per credited line. */
export async function applyCreditNoteAdjustments(
  db: Queryable,
  creditNoteId: string,
): Promise<boolean> {
  const note = await one<{ invoice_id: string }>(
    db,
    `SELECT invoice_id FROM credit_notes WHERE id = $1`,
    [creditNoteId],
  );
  if (note === null) return true;
  const invoice = await one<{ killbill_invoice_id: string | null; organisation_id: string }>(
    db,
    `SELECT killbill_invoice_id, organisation_id FROM invoices WHERE id = $1`,
    [note.invoice_id],
  );
  const accountId = await one<{ killbill_account_id: string }>(
    db,
    `SELECT killbill_account_id FROM killbill_accounts WHERE external_key = $1`,
    [`kerf-org-${invoice?.organisation_id ?? ''}`],
  );
  if (invoice?.killbill_invoice_id === null || invoice === null || accountId === null) return true;

  const pending = await many<{ id: string; line_id: string; amount_cents: number }>(
    db,
    `SELECT id, line_id, amount_cents FROM credit_note_lines
     WHERE credit_note_id = $1 AND killbill_adjustment_id IS NULL`,
    [creditNoteId],
  );
  try {
    for (const line of pending) {
      const item = await one<{ killbill_invoice_item_id: string | null }>(
        db,
        `SELECT killbill_invoice_item_id FROM invoice_items
         WHERE invoice_id = $1 AND line_id = $2`,
        [note.invoice_id, line.line_id],
      );
      if (item?.killbill_invoice_item_id === null || item === null) continue;
      await killbill.adjustInvoiceItem(
        invoice.killbill_invoice_id as string,
        item.killbill_invoice_item_id,
        accountId.killbill_account_id,
        line.amount_cents,
      );
      await db.query(
        `UPDATE credit_note_lines SET killbill_adjustment_id = $2 WHERE id = $1`,
        [line.id, item.killbill_invoice_item_id],
      );
    }
    return true;
  } catch (error) {
    if (error instanceof PaymentUnavailable) return false;
    throw error;
  }
}

async function freeSeats(db: Queryable, lines: readonly LineRow[]): Promise<void> {
  const freedPerSession = new Map<string, number>();
  for (const line of lines) {
    if (line.session_id === null) continue;
    freedPerSession.set(line.session_id, (freedPerSession.get(line.session_id) ?? 0) + 1);
  }
  for (const [sessionId, freed] of freedPerSession) {
    await offerFreedSeats(db, sessionId, freed);
  }
}

/** Cancelling a session refunds every line for that session on every order. */
export async function refundCancelledSession(
  db: Queryable,
  sessionId: string,
  actor: string,
): Promise<number> {
  const affected = await many<{ order_id: string }>(
    db,
    `SELECT DISTINCT order_id FROM order_lines
     WHERE session_id = $1 AND state IN ('captured', 'transferred', 'proof_pending')`,
    [sessionId],
  );

  for (const { order_id: orderId } of affected) {
    const order = await loadOrder(db, orderId);
    if (order === null) continue;
    const lines = (await orderLines(db, orderId)).filter(
      (line) =>
        line.session_id === sessionId &&
        (line.state === 'captured' || line.state === 'transferred' || line.state === 'proof_pending'),
    );
    await refundOrderLines(db, order, lines, 'Session cancelled', actor);
  }

  await db.query(
    `UPDATE holds SET status = 'released' WHERE session_id = $1 AND status = 'active'`,
    [sessionId],
  );
  await db.query(
    `UPDATE waitlist_entries SET status = 'closed' WHERE session_id = $1
     AND status IN ('waiting', 'offered')`,
    [sessionId],
  );

  return affected.length;
}

/** Finishes refunds left pending by a payment outage, exactly once each. */
export async function completePendingRefunds(db: Queryable): Promise<number> {
  const pending = await many<RefundRow>(
    db,
    `SELECT id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason,
            created_at
     FROM refunds WHERE status = 'pending' ORDER BY created_at`,
  );
  let completed = 0;
  for (const refund of pending) {
    const order = await loadOrder(db, refund.order_id);
    if (order === null) continue;
    let done: boolean;
    if (refund.credit_note_id !== null) {
      done = await applyCreditNoteAdjustments(db, refund.credit_note_id);
    } else if (refund.card_cents > 0) {
      done = await sendCardRefund(db, order, refund.id, refund.card_cents);
    } else {
      done = true;
    }
    if (done) {
      await db.query(`UPDATE refunds SET status = 'completed' WHERE id = $1`, [refund.id]);
      completed += 1;
    }
  }
  return completed;
}
