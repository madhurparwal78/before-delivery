import { pool, withClient } from './db.js';
import { env, databaseName } from './env.js';
import * as kb from './services/killbill.js';
import { flushOutbox } from './services/mail.js';
import * as cartDomain from './domain/cart.js';
import * as emails from './domain/emails.js';
import {
  DUNNING_STEPS,
  claimDueDunningSteps,
  clearDunning,
  clearShipmentsHeld,
  markStepDone,
  setShipmentsHeld,
  subscriptionEmail,
} from './domain/dunning.js';
import type { StoredCard } from './domain/card.js';
import type { RefundSplit } from './domain/refund.js';
import * as subsDomain from './domain/subscriptions.js';
import type { SubscriptionRow, ChangeRequestRow } from './domain/subscriptions.js';
import * as ordersDomain from './domain/orders.js';
import { buildBoxInvoice, chargeBoxInvoice } from './domain/renewal.js';

async function claimJob(name: string, ttlSeconds: number): Promise<boolean> {
  return withClient(async (client) => {
    const q = await client.query<{ one: number }>(
      `insert into job_locks (name, locked_until) values ($1, now() + make_interval(secs => $2))
       on conflict (name) do update set locked_until = now() + make_interval(secs => $2)
       where job_locks.locked_until is null or job_locks.locked_until < now()
       returning 1 as one`,
      [name, ttlSeconds]
    );
    return q.rows.length > 0;
  });
}

function every(ms: number, name: string, ttlSeconds: number, fn: () => Promise<void>): void {
  void (async () => {
    for (;;) {
      const claimed = await claimJob(name, ttlSeconds).catch(() => false);
      if (claimed) {
        try {
          await fn();
        } catch (e) {
          console.error(`[job ${name}] failed: ${(e as Error).message}`);
        }
      }
      await new Promise((r) => setTimeout(r, ms));
    }
  })();
}

export function startJobs(): void {
  every(500, 'hold-expiry', 4, async () => {
    await cartDomain.releaseExpiredHolds();
  });
  every(2000, 'renewals', 15, processRenewals);
  every(2000, 'dunning', 15, processDunning);
  every(2000, 'changes', 15, processChangeConfirmations);
  every(2000, 'refunds', 15, processRefundConfirmations);
  every(1000, 'outbox', 8, async () => {
    await flushOutbox();
  });
  every(5000, 'upcoming-emails', 20, processUpcomingRenewalEmails);
  every(60_000, 'cleanup', 60, async () => {
    await pool.query(`delete from idempotency_keys where created_at < now() - interval '24 hours'`);
  });
}

async function listSubs(): Promise<SubscriptionRow[]> {
  return withClient(async (client) => {
    const q = await client.query('select * from subscriptions');
    const rows = q.rows as unknown as SubscriptionRow[];
    for (const row of rows) row.next_cycle = subsDomain.ymd(row.next_cycle);
    return rows;
  });
}

// ---------- renewals ----------

async function processRenewals(): Promise<void> {
  const kbNow = await kb.getClock();
  const rows = await listSubs();
  for (const row of rows) {
    await handleSubscriptionRenewal(row, kbNow);
  }
}

async function handleSubscriptionRenewal(row: SubscriptionRow, kbNow: Date): Promise<void> {
  let sub;
  try {
    sub = await kb.getSubscription(row.id);
  } catch (e) {
    if (e instanceof kb.KillBillUnavailable) return;
    throw e;
  }
  if (sub.cancelledDate) return;
  if (!subsDomain.getPlan(row.plan)) return;
  if (!row.next_cycle) return;
  const periodMonths = subsDomain.periodMonthsOf(row);
  const states = await kb.getBlockingStates(row.kb_account_id);
  const raw = states
    .filter((s) => s.service === 'ceibo' && s.blockedId === row.id)
    .map((s) => ({ stateName: s.stateName, effectiveDate: s.effectiveDate }));
  if (kbNow.getTime() < Date.parse(`${row.next_cycle}T00:00:00Z`)) return;

  const cycle = row.next_cycle;
  if (subsDomain.cycleBlocked(raw, cycle)) {
    await subsDomain.advanceNextCycle(row.id, periodMonths);
    return;
  }

  const cycleRow = await withClient(async (client) => {
    await client.query(
      `insert into sub_cycles (subscription_id, cycle_date, state) values ($1, $2, 'pending')
       on conflict (subscription_id, cycle_date) do nothing`,
      [row.id, cycle]
    );
    const q = await client.query('select * from sub_cycles where subscription_id = $1 and cycle_date = $2', [row.id, cycle]);
    return q.rows[0] as { state: string; invoice_id: string | null; order_number: string | null; trigger_done: boolean };
  });
  if (cycleRow.state !== 'pending') return;

  const invoices = await kb.getInvoices(row.kb_account_id);
  const hasCycleInvoice = invoices.some((i) => i.targetDate === cycle);
  if (!hasCycleInvoice && !cycleRow.trigger_done) {
    await kb.triggerInvoice(row.kb_account_id, cycle);
    await withClient(async (client) => {
      await client.query('update sub_cycles set trigger_done = true where subscription_id = $1 and cycle_date = $2', [row.id, cycle]);
    });
    return;
  }
  for (let i = 0; i < 3 && !hasCycleInvoice; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const again = await kb.getInvoices(row.kb_account_id);
    if (again.some((inv) => inv.targetDate === cycle)) break;
  }

  const claimed = await withClient(async (client) => {
    const q = await client.query(
      `update sub_cycles set state = 'processing' where subscription_id = $1 and cycle_date = $2 and state = 'pending' returning 1`,
      [row.id, cycle]
    );
    return q.rows.length > 0;
  });
  if (!claimed) return;

  try {
    const invoiceId = await buildBoxInvoice(row, cycle);
    await withClient(async (client) => {
      await client.query('update sub_cycles set invoice_id = $3 where subscription_id = $1 and cycle_date = $2', [row.id, cycle, invoiceId]);
    });
    const result = await chargeBoxInvoice(row, invoiceId, row.card as unknown as StoredCard);
    if (!result.approved) {
      const failedAt = new Date();
      await withClient(async (client) => {
        for (const s of DUNNING_STEPS) {
          await client.query(
            `insert into dunning_steps (subscription_id, step, due_at, status, invoice_id)
             values ($1, $2, $3, 'pending', $4) on conflict (subscription_id, step) do nothing`,
            [row.id, s.step, new Date(failedAt.getTime() + s.day * env.dunningDaySeconds * 1000), invoiceId]
          );
        }
      });
      const email = await subscriptionEmail(row.id);
      const cancelDue = new Date(failedAt.getTime() + 14 * env.dunningDaySeconds * 1000);
      if (email) await emails.queueDunningEmail(email, 'day0', cancelDue);
    }
    await withClient(async (client) => {
      await client.query(
        "update sub_cycles set state = 'done', order_number = $3 where subscription_id = $1 and cycle_date = $2",
        [row.id, cycle, result.orderNumber]
      );
    });
    await subsDomain.advanceNextCycle(row.id, periodMonths);
  } catch (e) {
    if (e instanceof kb.KillBillUnavailable) {
      await withClient(async (client) => {
        await client.query("update sub_cycles set state = 'pending' where subscription_id = $1 and cycle_date = $2", [row.id, cycle]);
      });
      return;
    }
    throw e;
  }
}

// ---------- dunning steps ----------

async function processDunning(): Promise<void> {
  const steps = await claimDueDunningSteps(new Date());
  for (const step of steps) {
    const row = await subsDomain.loadSubscriptionRow(step.subscription_id);
    if (!row) continue;
    const email = await subscriptionEmail(step.subscription_id);
    const cancelDue = await withClient(async (client) => {
      const q = await client.query<{ due_at: Date }>(
        "select due_at from dunning_steps where subscription_id = $1 and step = 'cancel'",
        [step.subscription_id]
      );
      return q.rows[0]?.due_at as Date;
    });
    try {
      if (step.kind === 'retry') {
        const result = await chargeBoxInvoice(row, step.invoice_id ?? '', row.card as unknown as StoredCard);
        if (result.approved) {
          await clearDunning(row.id);
          await clearShipmentsHeld(row);
          await subsDomain.advanceNextCycle(row.id, subsDomain.periodMonthsOf(row));
          await markStepDone(row.id, step.step);
          continue;
        }
        if (email) {
          const r = step.step.replace('retry', '');
          await emails.queueDunningEmail(email, `retry${r}` as 'retry1', cancelDue);
        }
        await markStepDone(row.id, step.step);
      } else if (step.kind === 'email') {
        if (email) await emails.queueDunningEmail(email, 'day0', cancelDue);
        await markStepDone(row.id, step.step);
      } else if (step.kind === 'hold') {
        await setShipmentsHeld(row);
        if (email) await emails.queueDunningEmail(email, 'hold', cancelDue);
        await markStepDone(row.id, step.step);
      } else if (step.kind === 'cancel') {
        await subsDomain.dunningCancel(row);
        if (email) await emails.queueDunningEmail(email, 'cancel', cancelDue);
        await markStepDone(row.id, step.step);
      }
    } catch (e) {
      if (e instanceof kb.KillBillUnavailable) continue;
      throw e;
    }
  }
}

// ---------- change confirmations ----------

async function processChangeConfirmations(): Promise<void> {
  const pending = await withClient(async (client) => {
    const q = await client.query(
      "select * from change_requests where status = 'pending_provider' order by requested_at limit 10"
    );
    return q.rows as unknown as ChangeRequestRow[];
  });
  for (const change of pending) {
    const row = await subsDomain.loadSubscriptionRow(change.subscription_id);
    if (!row) continue;
    const effective = subsDomain.ymd(change.effective_date);
    try {
      const kbNow = await kb.getClock();
      const dunning = await subsDomain.readDunning(row.id);
      const { pending: _p, lastChange } = await subsDomain.readChanges(row.id);
      const view = await subsDomain.subscriptionView(row, kbNow, dunning, null, lastChange, env.changeCutoffHours);
      try {
        await subsDomain.applyChangeToKillBill(change.kind as 'pause', row, view, change.payload);
      } catch {
        await withClient(async (client) => {
          await client.query("update change_requests set status = 'rejected' where id = $1", [change.id]);
        });
        continue;
      }
      let confirmed = false;
      if (change.kind === 'cancel') {
        const sub = await kb.getSubscription(row.id);
        confirmed = sub.cancelledDate !== null;
      } else if (change.kind === 'swap') {
        const sub = await kb.getSubscription(row.id);
        confirmed = sub.planName === change.payload.plan;
      } else {
        const states = await kb.getBlockingStates(row.kb_account_id);
        const wanted = change.kind === 'pause' ? 'CEIBO_PAUSED' : change.kind === 'skip' ? 'CEIBO_SKIPPED' : 'CEIBO_ACTIVE';
        confirmed = states.some(
          (s) => s.blockedId === row.id && s.stateName === wanted && s.effectiveDate.slice(0, 10) === effective
        );
      }
      if (!confirmed) continue;
      await withClient(async (client) => {
        await client.query("update change_requests set status = 'applied' where id = $1", [change.id]);
      });
      const email = await subscriptionEmail(row.id);
      if (email) {
        if (change.kind === 'pause') {
          await emails.queueChangeApplied(email, 'pause', {
            from: effective,
            resumes: addMonthsLocal(effective, subsDomain.periodMonthsOf(row) * Number(change.payload.cycles ?? 1)),
          });
        } else if (change.kind === 'skip') {
          await emails.queueChangeApplied(email, 'skip', { from: effective });
        } else if (change.kind === 'swap') {
          const plan = subsDomain.getPlan(String(change.payload.plan));
          await emails.queueChangeApplied(email, 'swap', { from: effective, planLabel: plan?.label ?? '' });
        } else if (change.kind === 'cancel') {
          const sub = await kb.getSubscription(row.id);
          const endDate =
            sub.cancelledDate && sub.cancelledDate.slice(0, 10) >= row.next_cycle
              ? sub.cancelledDate.slice(0, 10)
              : row.next_cycle;
          await emails.queueChangeApplied(email, 'cancel', { endDate });
        } else if (change.kind === 'resume') {
          await emails.queueChangeApplied(email, 'resume', {});
        }
      }
    } catch (e) {
      if (e instanceof kb.KillBillUnavailable) continue;
      throw e;
    }
  }
}

function addMonthsLocal(ymdStr: string, months: number): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day, 12)).toISOString().slice(0, 10);
}

// ---------- refund confirmations ----------

async function processRefundConfirmations(): Promise<void> {
  const pending = await withClient(async (client) => {
    const q = await client.query(
      "select * from refunds where status = 'pending_provider' order by created_at limit 10"
    );
    return q.rows as unknown as {
      id: string;
      order_number: string;
      amount_cents: number;
      reason: string;
      split: RefundSplit;
    }[];
  });
  for (const refund of pending) {
    try {
      const order = await ordersDomain.getOrder(refund.order_number);
      if (!order) continue;
      const payment = await kb.findPaymentByExternalKey(`${databaseName()}/${order.number}`);
      if (!payment) continue;
      const key = `${databaseName()}/refund/${refund.id}`;
      const already = Math.round(payment.refundedAmount * 100);
      if (already < refund.amount_cents) {
        await kb.refundPayment(payment.paymentId, refund.amount_cents, key);
      }
      const after = await kb.findPaymentByExternalKey(`${databaseName()}/${order.number}`);
      const refundedNow = Math.round((after?.refundedAmount ?? 0) * 100);
      if (refundedNow < refund.amount_cents) continue;
      const priorApplied = await withClient(async (client) => {
        const q = await client.query<{ total: number }>(
          "select coalesce(sum(amount_cents),0)::int as total from refunds where order_number = $1 and status = 'applied'",
          [order.number]
        );
        return q.rows[0].total;
      });
      const isFull = refund.amount_cents >= order.total_cents - priorApplied;
      await withClient(async (client) => {
        await client.query("update refunds set status = 'applied', kb_refund_txn_id = $2 where id = $1", [refund.id, key]);
        await client.query(
          `update orders set
             refunded_cents = (select coalesce(sum(amount_cents),0) from refunds where order_number = $1 and status = 'applied'),
             refund_status = $2
           where number = $1`,
          [order.number, isFull ? 'refunded' : 'partially_refunded']
        );
      });
      if (isFull && order.status !== 'shipped' && order.status !== 'refunded') {
        await withClient(async (client) => {
          await client.query("update orders set status = 'refunded' where number = $1", [order.number]);
        });
        await ordersDomain.restockOrderCans(order);
      }
      await emails.queueRefundEmail({ number: order.number, email: order.email }, refund.amount_cents, refund.split);
    } catch (e) {
      if (e instanceof kb.KillBillUnavailable) continue;
      throw e;
    }
  }
}

// ---------- upcoming renewal emails ----------

async function processUpcomingRenewalEmails(): Promise<void> {
  const kbNow = await kb.getClock();
  const rows = await listSubs();
  for (const row of rows) {
    let sub;
    try {
      sub = await kb.getSubscription(row.id);
    } catch (e) {
      if (e instanceof kb.KillBillUnavailable) return;
      throw e;
    }
    if (sub.cancelledDate || !row.next_cycle) continue;
    const states = await kb.getBlockingStates(row.kb_account_id);
    const raw = states
      .filter((s) => s.service === 'ceibo' && s.blockedId === row.id)
      .map((s) => ({ stateName: s.stateName, effectiveDate: s.effectiveDate }));
    const periodMonths = subsDomain.periodMonthsOf(row);
    let nextRenewal = row.next_cycle;
    let guard = 0;
    while (guard < 60 && subsDomain.cycleBlocked(raw, nextRenewal)) {
      nextRenewal = addMonthsLocal(nextRenewal, periodMonths);
      guard++;
    }
    const cutoffMs = Date.parse(`${nextRenewal}T00:00:00Z`) - env.changeCutoffHours * 3600 * 1000;
    if (kbNow.getTime() < cutoffMs) continue;
    const email = await subscriptionEmail(row.id);
    if (!email) continue;
    const sent = await withClient(async (client) => {
      await client.query(
        `insert into upcoming_emails (subscription_id, cycle_date, sent) values ($1, $2, false)
         on conflict (subscription_id, cycle_date) do nothing`,
        [row.id, nextRenewal]
      );
      const q = await client.query(
        'update upcoming_emails set sent = true where subscription_id = $1 and cycle_date = $2 and sent = false returning 1',
        [row.id, nextRenewal]
      );
      return q.rows.length > 0;
    });
    if (sent) {
      await emails.queueUpcomingRenewal(email, nextRenewal);
    }
  }
}
