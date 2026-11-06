/**
 * Background work, all coordinated through PostgreSQL so instances sharing a
 * database do each job once.
 *
 *  - callback registration retries until Kill Bill answers;
 *  - holds expire on the server's clock with no client involved;
 *  - instalments are collected when they fall due, with no client involved;
 *  - refund draws left unsent by an unreachable Kill Bill go out on return.
 */

import { randomUUID } from 'node:crypto';

import type { StageName } from '../../shared/types.js';
import { addDays, startOfAmsterdamDate, shopNow } from '../domain/clock.js';
import { query, transact } from '../db/pool.js';
import { ensureCallbackSecret } from '../db/seed.js';
import {
  KillbillRefused,
  KillbillUnreachable,
  killbillStatus,
  purchase,
  registerCallback,
} from '../providers/killbill.js';
import { unsentDraws, sendDraws } from '../services/refunds.js';
import { expireLapsedHolds } from '../services/rides.js';
import { MAX_COLLECTION_ATTEMPTS } from '../services/notifications.js';

const HOLD_TICK_MS = 500;
const COLLECTION_TICK_MS = 500;
const CALLBACK_RETRY_MS = 5_000;
const DRAW_RETRY_MS = 5_000;

/** Retries after a failed first attempt, in days after the due date. */
const RETRY_OFFSET_DAYS = [0, 3, 6];

function callbackUrl(secret: string): string {
  const origin = process.env.KILLBILL_CALLBACK_ORIGIN ?? `http://main:${process.env.APP_PUBLIC_PORT ?? 4173}`;
  return `${origin}/api/killbill/notifications/${secret}`;
}

/** Register this instance's callback, retrying in the background until it takes. */
export function startCallbackRegistration(): void {
  let done = false;
  const attempt = async (): Promise<void> => {
    if (done) return;
    try {
      const secret = await ensureCallbackSecret();
      await registerCallback(callbackUrl(secret));
      done = true;
      console.log('[killbill] callback registered');
    } catch {
      // Kill Bill or the database is not there yet; the timer tries again.
    }
  };
  void attempt();
  const timer = setInterval(() => {
    if (done) {
      clearInterval(timer);
      return;
    }
    void attempt();
  }, CALLBACK_RETRY_MS);
  timer.unref();
}

export function startHoldExpiry(): void {
  setInterval(() => {
    void expireLapsedHolds().catch(() => undefined);
  }, HOLD_TICK_MS).unref();
}

interface DueStage {
  order_id: string;
  stage: StageName;
  due_date: string;
  attempts: number;
  amount_cents: number;
  state: string;
  user_id: string;
}

/** A stage's attempt is due once its offset day has begun in Amsterdam. */
function attemptIsDue(dueDate: string, attempts: number, now: Date): boolean {
  const offset = RETRY_OFFSET_DAYS[attempts];
  if (offset === undefined) return false;
  return now.getTime() >= startOfAmsterdamDate(addDays(dueDate, offset)).getTime();
}

async function candidates(): Promise<DueStage[]> {
  const rows = await query<DueStage>(
    `SELECT s.order_id, s.stage, s.due_date, s.attempts, s.amount_cents, o.state, o.user_id
     FROM order_stages s
     JOIN orders o ON o.id = s.order_id
     WHERE s.due_date IS NOT NULL
       AND s.status IN ('scheduled', 'failed')
       AND o.state IN ('deposit confirmed', 'instalments running')
     ORDER BY s.due_date, s.position`,
  );
  return rows.rows;
}

/** Stages falling due while in arrears become overdue, and nothing is collected. */
async function markOverdueWhileInArrears(now: Date): Promise<void> {
  const rows = await query<{ order_id: string; stage: StageName; due_date: string }>(
    `SELECT s.order_id, s.stage, s.due_date
     FROM order_stages s
     JOIN orders o ON o.id = s.order_id
     WHERE o.state = 'in arrears' AND s.status = 'scheduled' AND s.due_date IS NOT NULL`,
  );
  for (const row of rows.rows) {
    if (now.getTime() < startOfAmsterdamDate(row.due_date).getTime()) continue;
    await query("UPDATE order_stages SET status = 'overdue' WHERE order_id = $1 AND stage = $2", [
      row.order_id,
      row.stage,
    ]);
  }
}

interface Claim {
  paymentId: string;
  externalKey: string;
  amountCents: number;
  accountId: string;
  attempt: number;
}

/**
 * Claim one attempt. The unique external key makes the payment row the claim,
 * so only one instance calls Kill Bill for it.
 */
async function claimCollection(row: DueStage): Promise<Claim | null> {
  return transact(async (client) => {
    const stage = await client.query<{ status: string; attempts: number; amount_cents: number }>(
      `SELECT s.status, s.attempts, s.amount_cents FROM order_stages s
       JOIN orders o ON o.id = s.order_id
       WHERE s.order_id = $1 AND s.stage = $2 FOR UPDATE OF s`,
      [row.order_id, row.stage],
    );
    const current = stage.rows[0];
    if (!current || !['scheduled', 'failed'].includes(current.status)) return null;

    // A collection falling due while a payment or refund is pending is deferred.
    const busy = await client.query(
      `SELECT 1 FROM order_stages WHERE order_id = $1 AND status = 'pending'
       UNION ALL
       SELECT 1 FROM refunds WHERE order_id = $1 AND status = 'pending'`,
      [row.order_id],
    );
    if (busy.rowCount && busy.rowCount > 0) return null;

    const account = await client.query<{ account_id: string }>(
      'SELECT account_id FROM killbill_accounts WHERE user_id = $1',
      [row.user_id],
    );
    const accountId = account.rows[0]?.account_id;
    if (!accountId) return null;

    const attempt = current.attempts + 1;
    const externalKey = `collect:${row.order_id}:${row.stage}:${attempt}`;
    const paymentId = randomUUID();

    const inserted = await client.query(
      `INSERT INTO payments(id, order_id, stage, attempt, external_key, amount_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (external_key) DO NOTHING
       RETURNING id`,
      [paymentId, row.order_id, row.stage, attempt, externalKey, current.amount_cents],
    );
    if (inserted.rowCount === 0) return null;

    await client.query(
      `UPDATE order_stages SET status = 'pending', attempts = $3 WHERE order_id = $1 AND stage = $2`,
      [row.order_id, row.stage, attempt],
    );
    await client.query(
      `UPDATE orders SET state = 'instalments running' WHERE id = $1 AND state = 'deposit confirmed'`,
      [row.order_id],
    );

    return { paymentId, externalKey, amountCents: current.amount_cents, accountId, attempt };
  });
}

/** Undo a claim Kill Bill never saw: the attempt counts nothing. */
async function deferClaim(row: DueStage, claim: Claim): Promise<void> {
  await transact(async (client) => {
    await client.query('DELETE FROM payments WHERE id = $1', [claim.paymentId]);
    await client.query(
      `UPDATE order_stages SET status = 'scheduled', attempts = $3 WHERE order_id = $1 AND stage = $2`,
      [row.order_id, row.stage, claim.attempt - 1],
    );
  });
}

async function failClaim(row: DueStage, claim: Claim): Promise<void> {
  await transact(async (client) => {
    await client.query("UPDATE payments SET status = 'failed' WHERE id = $1", [claim.paymentId]);
    if (claim.attempt >= MAX_COLLECTION_ATTEMPTS) {
      await client.query("UPDATE order_stages SET status = 'overdue' WHERE order_id = $1 AND stage = $2", [
        row.order_id,
        row.stage,
      ]);
      await client.query(
        `UPDATE orders SET state = 'in arrears'
         WHERE id = $1 AND state IN ('instalments running', 'deposit confirmed')`,
        [row.order_id],
      );
      return;
    }
    await client.query("UPDATE order_stages SET status = 'failed' WHERE order_id = $1 AND stage = $2", [
      row.order_id,
      row.stage,
    ]);
  });
}

async function collectTick(): Promise<void> {
  const now = shopNow();
  await markOverdueWhileInArrears(now);

  // Kill Bill being unreachable is not a failure: the attempt is deferred.
  if (killbillStatus() === 'down') return;

  for (const row of await candidates()) {
    if (!attemptIsDue(row.due_date, row.attempts, now)) continue;

    const claim = await claimCollection(row);
    if (!claim) continue;

    try {
      const payment = await purchase(claim.accountId, claim.amountCents, claim.externalKey);
      const transaction = payment.transactions.find(
        (t) => t.transactionExternalKey === claim.externalKey,
      );
      await query(
        'UPDATE payments SET killbill_payment_id = $2, killbill_transaction_id = $3 WHERE id = $1',
        [claim.paymentId, payment.paymentId, transaction?.transactionId ?? null],
      );
      // The stage stays pending until a believed notification settles it.
    } catch (error) {
      if (error instanceof KillbillUnreachable) {
        await deferClaim(row, claim);
        continue;
      }
      if (error instanceof KillbillRefused) {
        await failClaim(row, claim);
        continue;
      }
      throw error;
    }
  }
}

export function startCollection(): void {
  setInterval(() => {
    void collectTick().catch((error) => {
      if (error instanceof Error) console.error('[collection]', error.message);
    });
  }, COLLECTION_TICK_MS).unref();
}

/** Draws left unsent by an unreachable Kill Bill go out with their same keys. */
export function startRefundRetry(): void {
  setInterval(() => {
    if (killbillStatus() === 'down') return;
    void transact(async (client) => unsentDraws(client))
      .then(async (draws) => {
        if (draws.length > 0) await sendDraws(draws);
      })
      .catch(() => undefined);
  }, DRAW_RETRY_MS).unref();
}

