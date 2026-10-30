import { many, one, pool, withAdvisoryLock, withTransaction, type Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';
import { writeAudit } from '../domain/audit.js';
import {
  billingDays,
  creditedCents,
  loadInvoice,
  nextRetryInstant,
  paidCents,
  RETRY_SETTLE_BILLING_DAYS,
  firstReturnAt,
} from '../domain/invoices.js';
import { expiredHold, lapsedOffer } from '../domain/liveness.js';
import { lapseProofHold } from '../domain/proofs.js';
import { completePendingRefunds } from '../domain/refunds.js';
import { makeOffer, offerFreedSeats } from '../domain/seats.js';
import { ensureKillBillAccount } from '../domain/checkout.js';
import { recordPayment } from '../domain/payments.js';
import * as killbill from '../services/killbill.js';
import { PaymentUnavailable } from '../services/killbill.js';
import { deliverOutbox } from '../services/mail.js';
import { pruneIdempotencyKeys } from '../http/idempotency.js';

const TICK_MS = 1500;

const SYSTEM = { actor: 'system', actorRole: 'system' } as const;

/** A hold is expired from its expiry instant on; its seats go back or to the waitlist. */
async function expireHolds(): Promise<void> {
  const expired = await many<{ id: string; session_id: string; quantity: number }>(
    pool,
    `UPDATE holds SET status = 'expired' WHERE ${expiredHold('holds')}
     RETURNING id, session_id, quantity`,
  );
  for (const hold of expired) {
    await withTransaction(async (tx) => {
      await offerFreedSeats(tx, hold.session_id, hold.quantity);
      await writeAudit(tx, {
        ...SYSTEM,
        action: 'hold.expired',
        targetType: 'hold',
        targetId: hold.id,
        detail: { session_id: hold.session_id, quantity: hold.quantity },
      });
    });
  }
}

/** A lapsed offer passes to the next person in line. */
async function lapseOffers(): Promise<void> {
  const lapsed = await many<{ id: string; session_id: string }>(
    pool,
    `UPDATE waitlist_entries SET status = 'lapsed' WHERE ${lapsedOffer('waitlist_entries')}
     RETURNING id, session_id`,
  );
  for (const entry of lapsed) {
    await withTransaction(async (tx) => {
      const next = await one<{ id: string; user_id: string }>(
        tx,
        `SELECT id, user_id FROM waitlist_entries
         WHERE session_id = $1 AND status = 'waiting' ORDER BY seq LIMIT 1`,
        [entry.session_id],
      );
      if (next !== null) {
        await makeOffer(tx, next.id, next.user_id, entry.session_id);
      }
      await writeAudit(tx, {
        ...SYSTEM,
        action: 'waitlist_offer.lapsed',
        targetType: 'waitlist_entry',
        targetId: entry.id,
        detail: { session_id: entry.session_id },
      });
    });
  }
}

/** The server records the move at exactly publish_at, with `by` set to system. */
async function publishScheduled(): Promise<void> {
  const sessions = await many<{ id: string; publish_at: Date }>(
    pool,
    `UPDATE programme_sessions SET status = 'published', version = version + 1
     WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= now()
     RETURNING id, publish_at`,
  );
  for (const session of sessions) {
    await withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO session_history (id, session_id, from_state, to_state, at, actor)
         VALUES ($1, $2, 'scheduled', 'published', $3, 'system')`,
        [newId(), session.id, session.publish_at],
      );
      await writeAudit(tx, {
        ...SYSTEM,
        action: 'session.published',
        targetType: 'session',
        targetId: session.id,
        detail: { publish_at: session.publish_at.toISOString() },
      });
    });
  }

  const entries = await many<{ id: string; publish_at: Date }>(
    pool,
    `UPDATE entries SET status = 'published'
     WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= now()
     RETURNING id, publish_at`,
  );
  for (const entry of entries) {
    await withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO entry_history (id, entry_id, from_state, to_state, at, actor)
         VALUES ($1, $2, 'scheduled', 'published', $3, 'system')`,
        [newId(), entry.id, entry.publish_at],
      );
      await writeAudit(tx, {
        ...SYSTEM,
        action: 'entry.published',
        targetType: 'entry',
        targetId: entry.id,
        detail: { publish_at: entry.publish_at.toISOString() },
      });
    });
  }
}

/** A lapsed reduced-rate hold is voided and never captured. */
async function lapseProofs(): Promise<void> {
  const due = await many<{ id: string; order_id: string }>(
    pool,
    `SELECT p.id, p.order_id FROM proofs p
     WHERE p.status = 'pending' AND p.deadline <= now()
     UNION
     SELECT NULL::uuid AS id, o.id AS order_id FROM orders o
     WHERE o.rate = 'reduced' AND o.proof_deadline IS NOT NULL AND o.proof_deadline <= now()
       AND EXISTS (SELECT 1 FROM order_lines l
                   WHERE l.order_id = o.id AND l.state = 'proof_pending')`,
  );
  const seen = new Set<string>();
  for (const row of due) {
    if (seen.has(row.order_id)) continue;
    seen.add(row.order_id);
    try {
      await withTransaction(async (tx) => {
        await lapseProofHold(tx, row.order_id);
        await writeAudit(tx, {
          ...SYSTEM,
          action: 'proof.lapsed',
          targetType: 'order',
          targetId: row.order_id,
        });
      });
    } catch (error) {
      if (!(error instanceof PaymentUnavailable)) throw error;
    }
  }
}

async function collectInvoice(
  tx: Queryable,
  invoiceId: string,
  action: 'invoice.collected' | 'invoice.retried',
): Promise<void> {
  const invoice = await loadInvoice(tx, invoiceId);
  if (invoice === null || invoice.killbill_invoice_id === null) return;
  const balance =
    invoice.amount_cents - (await creditedCents(tx, invoiceId)) - (await paidCents(tx, invoiceId));
  if (balance <= 0) {
    await tx.query(
      `UPDATE invoices SET status = 'paid', collection_pending = false, next_retry_at = NULL
       WHERE id = $1`,
      [invoiceId],
    );
    return;
  }

  const attemptRow = await one<{ next: number }>(
    tx,
    `SELECT COALESCE(MAX(attempt), 0) + 1 AS next FROM invoice_collections WHERE invoice_id = $1`,
    [invoiceId],
  );
  const attempt = attemptRow?.next ?? 1;
  const collectionId = newId();
  await tx.query(
    `INSERT INTO invoice_collections (id, invoice_id, attempt, amount_cents) VALUES ($1, $2, $3, $4)`,
    [collectionId, invoiceId, attempt, balance],
  );

  const accountId = await ensureKillBillAccount(
    tx,
    `kerf-org-${invoice.organisation_id}`,
    invoice.organisation_id,
    true,
  );
  const collected = await killbill.collectInvoice(
    invoice.killbill_invoice_id,
    accountId,
    balance,
    `${invoice.number}-${attempt}`,
  );
  await tx.query(`UPDATE invoice_collections SET killbill_payment_id = $2 WHERE id = $1`, [
    collectionId,
    collected.paymentId,
  ]);
  await recordPayment(tx, { invoiceId, transaction: collected.transaction });

  if (action === 'invoice.collected') {
    await tx.query(
      `UPDATE invoices SET status = 'paid', collection_pending = false WHERE id = $1`,
      [invoiceId],
    );
  } else {
    const firstReturn = (await firstReturnAt(tx, invoiceId)) ?? new Date();
    await tx.query(
      `UPDATE invoices SET status = 'retried', retries_used = retries_used + 1,
         retried_at = now(), next_retry_at = $2, collection_pending = false
       WHERE id = $1`,
      [invoiceId, nextRetryInstant(firstReturn, invoice.retries_used + 1)],
    );
  }

  await writeAudit(tx, {
    ...SYSTEM,
    action,
    targetType: 'invoice',
    targetId: invoiceId,
    detail: { attempt, amount_cents: balance },
  });
}

/** When an invoice falls due the server collects it, and waits while Kill Bill is down. */
async function collectDueInvoices(): Promise<void> {
  const due = await many<{ id: string }>(
    pool,
    `SELECT id FROM invoices WHERE status = 'issued' AND due_at <= now()`,
  );
  for (const invoice of due) {
    await pool.query(`UPDATE invoices SET collection_pending = true WHERE id = $1`, [invoice.id]);
    try {
      await withTransaction((tx) => collectInvoice(tx, invoice.id, 'invoice.collected'));
    } catch (error) {
      if (!(error instanceof PaymentUnavailable)) throw error;
    }
  }
}

async function runRetries(): Promise<void> {
  const due = await many<{ id: string }>(
    pool,
    `SELECT id FROM invoices
     WHERE status = 'payment_failed' AND next_retry_at IS NOT NULL AND next_retry_at <= now()`,
  );
  for (const invoice of due) {
    try {
      await withTransaction((tx) => collectInvoice(tx, invoice.id, 'invoice.retried'));
    } catch (error) {
      if (!(error instanceof PaymentUnavailable)) throw error;
    }
  }
}

/** A retried invoice becomes paid after two billing days with no further return. */
async function settleRetriedInvoices(): Promise<void> {
  await pool.query(
    `UPDATE invoices SET status = 'paid', next_retry_at = NULL
     WHERE status = 'retried' AND retried_at IS NOT NULL
       AND retried_at + ($1 || ' seconds')::interval <= now()
       AND NOT EXISTS (SELECT 1 FROM invoice_returns r
                       WHERE r.invoice_id = invoices.id AND r.created_at > invoices.retried_at)`,
    [String(billingDays(RETRY_SETTLE_BILLING_DAYS))],
  );
}

let ticking = false;
let pruneCountdown = 0;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await withAdvisoryLock('kerf-sweeper', async () => {
      await expireHolds();
      await lapseOffers();
      await publishScheduled();
      await lapseProofs();
      await collectDueInvoices();
      await runRetries();
      await settleRetriedInvoices();
      await withTransaction((tx) => completePendingRefunds(tx));
      if (pruneCountdown <= 0) {
        await pruneIdempotencyKeys();
        pruneCountdown = 600;
      }
      pruneCountdown -= 1;
    });
    await deliverOutbox();
  } catch (error) {
    process.stderr.write(`sweeper pass failed: ${String(error)}\n`);
  } finally {
    ticking = false;
  }
}

export function startSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  timer.unref();
  void tick();
  return timer;
}
