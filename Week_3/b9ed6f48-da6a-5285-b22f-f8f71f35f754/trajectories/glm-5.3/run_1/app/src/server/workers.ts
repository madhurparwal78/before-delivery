import type { App } from './api/app.ts';
import { recordAction } from './api/app.ts';
import { startDunning } from './api/membership.ts';
import { sendDunningReminder, sendDunningCancellation } from './api/dunning.ts';
import { minorToMajorString, type Currency } from './core/money.ts';
import { getCardState, decideChargeWithStoredClass } from './core/cards.ts';

/**
 * Background workers: scheduled publishing, dunning retries, mail delivery,
 * catalog sync. Every rule holds across several instances sharing one database.
 */

export function startWorkers(app: App): () => void {
  const timers: NodeJS.Timeout[] = [];

  timers.push(setInterval(() => void publishScheduled(app).catch(() => undefined), 2_000));
  timers.push(setInterval(() => void app.mail.flushWithRetry().catch(() => undefined), 5_000));
  timers.push(setInterval(() => void runDunning(app).catch(() => undefined), 5_000));

  const stop = (): void => {
    for (const t of timers) clearInterval(t);
  };
  return stop;
}

/** Publish scheduled items within 5 seconds of their publish_at, exactly once. */
async function publishScheduled(app: App): Promise<void> {
  const res = await app.pool.query(
    `UPDATE chapters SET status = 'published' WHERE status = 'scheduled' AND publish_at <= now()
     RETURNING number, title`,
  );
  for (const row of res.rows) {
    await recordAction(app, 'system', 'published', 'chapter', `chapter-${Number(row['number'])}`, {});
  }
  const evRes = await app.pool.query(
    `UPDATE events SET status = 'published' WHERE status = 'scheduled' AND publish_at <= now()
     RETURNING id, title`,
  );
  for (const row of evRes.rows) {
    await recordAction(app, 'system', 'published', 'event', String(row['id']), {});
  }
}

/**
 * Dunning: retry the unpaid invoice with the card on file at 1, 2 and 3 x
 * DUNNING_RETRY_SECONDS after the decline. Retries 1 and 2 send a reminder;
 * a failed third retry cancels the subscription.
 */
async function runDunning(app: App): Promise<void> {
  const res = await app.pool.query(
    `SELECT id, user_id, killbill_invoice_id, tier, currency, amount_minor, attempts, charge_kind
     FROM dunning WHERE cancelled = false AND settled_order_id IS NULL AND next_retry_at IS NOT NULL AND next_retry_at <= now()
     LIMIT 5`,
  );
  for (const row of res.rows) {
    const id = String(row['id']);
    const userId = String(row['user_id']);
    const invoiceId = String(row['killbill_invoice_id']);
    const currency = String(row['currency']) as Currency;
    const amountMinor = Number(row['amount_minor']);
    const attempts = Number(row['attempts']);
    const tier = String(row['tier']);
    const chargeKind = String(row['charge_kind']);
    const user = await app.pb.getUserById(userId);
    if (!user) continue;

    // Lock this dunning row so only one instance retries it.
    const lock = await app.pool.query(
      `UPDATE dunning SET next_retry_at = NULL WHERE id = $1 AND next_retry_at IS NOT NULL RETURNING id`,
      [id],
    );
    if (!lock.rows.length) continue;

    const card = await getCardState(app.pool, userId);
    const decision = await decideChargeWithStoredClass(app.pool, userId, card.outcomeClass ?? 'approved');

    if (decision.approved) {
      const accountRes = await app.pool.query(`SELECT account_id, currency FROM kb_accounts WHERE user_id = $1`, [userId]);
      const account = accountRes.rows[0];
      if (!account) continue;
      try {
        const payment = await app.kb.payInvoice(String(account['account_id']), invoiceId, minorToMajorString(amountMinor, currency), currency);
        const crypto = await import('node:crypto');
        const { recordSettlementForDunning } = await import('./api/settlement.ts');
        const orderId = crypto.randomUUID();
        const receipt = await recordSettlementForDunning(app, {
          id: orderId,
          userId,
          userName: user.name,
          kind: chargeKind === 'membership_upgrade' ? 'membership_upgrade' : 'membership_join',
          description: chargeKind === 'membership_upgrade' ? `Supporter upgrade: ${tier}` : `Supporter membership: ${tier}`,
          currency,
          amountMinor,
          cardLast4: card.last4 ?? decision.last4,
          kbAccountId: String(account['account_id']),
          kbInvoiceId: invoiceId,
          kbPaymentId: payment.paymentId,
          subject: `Your supporter upgrade — receipt ${'{receipt}'}`,
          tier,
        });
        await app.pool.query(`UPDATE dunning SET settled_order_id = $2, cancelled = true WHERE id = $1`, [id, orderId]);
        void receipt;
      } catch {
        await app.pool.query(
          `UPDATE dunning SET next_retry_at = now() + ($2 || ' seconds')::interval WHERE id = $1`,
          [id, String(app.config.dunningRetrySeconds)],
        );
      }
      continue;
    }

    // Failed retry.
    if (attempts >= 3) {
      const subRes = await app.pool.query(`SELECT subscription_id FROM memberships WHERE user_id = $1`, [userId]);
      const subscriptionId = subRes.rows[0]?.['subscription_id'];
      if (subscriptionId) {
        try {
          await app.kb.cancelImmediate(String(subscriptionId));
        } catch {
          /* keep going: the cancellation email still describes the state */
        }
      }
      await app.pool.query(`UPDATE dunning SET cancelled = true, next_retry_at = NULL WHERE id = $1`, [id]);
      await sendDunningCancellation(app, { id: userId, name: user.name, email: user.email, role: 'visitor' });
      continue;
    }
    await sendDunningReminder(app, { id: userId, name: user.name, email: user.email, role: 'visitor' }, attempts + 1);
    const delaySeconds = (attempts + 1) * app.config.dunningRetrySeconds;
    await app.pool.query(
      `UPDATE dunning SET attempts = $2, next_retry_at = now() + ($3 || ' seconds')::interval WHERE id = $1`,
      [id, attempts + 1, String(delaySeconds)],
    );
  }
}

export { startDunning };
