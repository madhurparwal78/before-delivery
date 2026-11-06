import type { Config } from '../config.js';
import { query } from '../db.js';
import { newId } from '../store.js';
import { shopNowMs } from '../clock.js';
import { euros } from './payments.js';
import { STAGES, type Stage } from './engine.js';
import { Killbill, KillbillError } from '../services/killbill.js';

// Instalment collection: due monthly, retried 3 and 6 days after the due date,
// deferred while Kill Bill is down or a refund is pending, moving the order
// into arrears after the third failure. Runs on the shop clock, checked at
// least once per real second, with no client involved.

const RETRY_OFFSETS_MS = [0, 3 * 86400_000, 6 * 86400_000];

export async function ensureKillbillAccount(kb: Killbill, userId: string, name: string, email: string): Promise<string> {
  const externalKey = `rider-${userId}`;
  const existing = await kb.accountByExternalKey(externalKey);
  if (existing) return existing;
  try {
    const accountId = await kb.createAccount(externalKey, name, email);
    await kb.addExternalPaymentMethod(accountId);
    return accountId;
  } catch (e) {
    if (e instanceof KillbillError && e.kind === 'refused') {
      const found = await kb.accountByExternalKey(externalKey);
      if (found) {
        await kb.addExternalPaymentMethod(found).catch(() => undefined);
        return found;
      }
    }
    throw e;
  }
}

export async function runCollectionSweep(config: Config, kb: Killbill, killbillUp: boolean): Promise<void> {
  if (!killbillUp) return;
  const nowMs = shopNowMs(config);

  const orders = await query<{ id: string; state: string; user_id: string }>(
    config,
    `select id, state, user_id from orders where state in ('deposit confirmed', 'instalments running', 'in arrears')`,
  );
  for (const order of orders.rows) {
    const pendingRefund = await query(config, `select 1 from refunds where order_id = $1 and status = 'pending'`, [order.id]);
    const deferred = pendingRefund.rows.length > 0;
    const payments = await query<{ id: string; stage: Stage; status: string; attempt: number; amount_cents: number; due_at: Date | null }>(
      config,
      `select id, stage, status, attempt, amount_cents, due_at from payments where order_id = $1`,
      [order.id],
    );
    const overdueExists = payments.rows.some((p) => p.status === 'overdue');
    for (const p of payments.rows) {
      if (p.stage === 'deposit') continue;
      if (!p.due_at) continue;
      const dueMs = new Date(p.due_at).getTime();
      if (nowMs < dueMs) continue;

      if (order.state === 'in arrears') {
        // No new collection starts while in arrears; stages falling due become overdue.
        if (p.status === 'scheduled') {
          await query(config, `update payments set status = 'overdue' where id = $1`, [p.id]);
        }
        continue;
      }
      if (p.status === 'paid' || p.status === 'pending' || p.status === 'overdue') continue;
      if (deferred) continue;
      if (p.attempt >= 3) continue;
      const attemptAt = dueMs + RETRY_OFFSETS_MS[p.attempt]!;
      if (nowMs < attemptAt) continue;

      // Collect this stage now.
      const user = await query<{ email: string; name: string }>(config, `select email, name from users where id = $1`, [order.user_id]);
      const externalKey = `collect:${order.id}:${p.stage}:${p.attempt + 1}`;
      try {
        const accountId = await ensureKillbillAccount(kb, order.user_id, user.rows[0]!.name, user.rows[0]!.email);
        await kb.purchase(accountId, euros(p.amount_cents), externalKey);
        await query(config, `update payments set status = 'pending', attempt = $2, external_key = $3 where id = $1`, [p.id, p.attempt + 1, externalKey]);
        if (order.state === 'deposit confirmed') {
          await query(config, `update orders set state = 'instalments running' where id = $1 and state = 'deposit confirmed'`, [order.id]);
        }
      } catch (e) {
        if (e instanceof KillbillError && e.kind === 'refused') {
          // Provider refusal: count the attempt; the third failure moves the
          // order into arrears and the stage to overdue.
          const newAttempt = p.attempt + 1;
          if (newAttempt >= 3) {
            await query(config, `update payments set status = 'overdue', attempt = $2, external_key = $3 where id = $1`, [p.id, newAttempt, externalKey]);
            await query(config, `update orders set state = 'in arrears' where id = $1`, [order.id]);
          } else {
            await query(config, `update payments set status = 'failed', attempt = $2, external_key = $3 where id = $1`, [p.id, newAttempt, externalKey]);
          }
        }
        // Unreachable: deferred, attempts unchanged.
      }
    }
    void overdueExists;
  }
  void newId;
  void STAGES;
}
