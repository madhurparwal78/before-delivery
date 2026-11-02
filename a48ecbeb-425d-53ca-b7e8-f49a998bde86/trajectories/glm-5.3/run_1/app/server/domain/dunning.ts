import { pool, withClient } from '../db.js';
import { env } from '../env.js';
import { addAccountBlockingState } from '../services/killbill.js';
import { loadSubscriptionRow } from './subscriptions.js';

export const DUNNING_STEPS: { step: string; day: number; kind: 'email' | 'retry' | 'hold' | 'cancel' }[] = [
  { step: 'day0', day: 0, kind: 'email' },
  { step: 'retry1', day: 1, kind: 'retry' },
  { step: 'retry2', day: 3, kind: 'retry' },
  { step: 'retry3', day: 7, kind: 'retry' },
  { step: 'hold', day: 8, kind: 'hold' },
  { step: 'cancel', day: 14, kind: 'cancel' },
];

export function stepDueAt(failedAt: Date, day: number): Date {
  return new Date(failedAt.getTime() + day * env.dunningDaySeconds * 1000);
}

export async function startDunning(subscriptionId: string, failedAt: Date, invoiceId: string | null): Promise<void> {
  await withClient(async (client) => {
    for (const s of DUNNING_STEPS) {
      await client.query(
        `insert into dunning_steps (subscription_id, step, due_at, status, invoice_id)
         values ($1, $2, $3, 'pending', $4) on conflict (subscription_id, step) do nothing`,
        [subscriptionId, s.step, stepDueAt(failedAt, s.day), invoiceId]
      );
    }
  });
}

export async function clearDunning(subscriptionId: string): Promise<void> {
  await pool.query(
    "update dunning_steps set status = 'dropped' where subscription_id = $1 and status = 'pending'",
    [subscriptionId]
  );
}

export interface DueStep {
  subscription_id: string;
  step: string;
  kind: 'email' | 'retry' | 'hold' | 'cancel';
  invoice_id: string | null;
}

export async function claimDueDunningSteps(now: Date): Promise<DueStep[]> {
  return withClient(async (client) => {
    const q = await client.query<DueStep & { due_at: Date }>(
      `select d.subscription_id, d.step, d.invoice_id,
        case when d.step = 'day0' then 'email'
             when d.step like 'retry%' then 'retry'
             when d.step = 'hold' then 'hold'
             else 'cancel' end as kind
       from dunning_steps d
       join subscriptions s on s.id = d.subscription_id
       where d.status = 'pending' and d.due_at <= $1
       order by d.due_at
       for update of d skip locked`,
      [now]
    );
    return q.rows;
  });
}

export async function markStepDone(subscriptionId: string, step: string): Promise<void> {
  await pool.query(
    "update dunning_steps set status = 'done' where subscription_id = $1 and step = $2",
    [subscriptionId, step]
  );
}

export async function markStepPending(subscriptionId: string, step: string): Promise<void> {
  await pool.query(
    "update dunning_steps set status = 'pending' where subscription_id = $1 and step = $2",
    [subscriptionId, step]
  );
}

export async function setShipmentsHeld(subscription: { kb_account_id: string }): Promise<void> {
  await addAccountBlockingState(subscription.kb_account_id, 'CEIBO_OVERDUE', 'ceibo-dunning', true);
}

export async function clearShipmentsHeld(subscription: { kb_account_id: string }): Promise<void> {
  await addAccountBlockingState(subscription.kb_account_id, 'CEIBO_CLEAR', 'ceibo-dunning', false);
}

export async function subscriptionEmail(subscriptionId: string): Promise<string | null> {
  const row = await loadSubscriptionRow(subscriptionId);
  if (!row) return null;
  const { getUser } = await import('../services/pocketbase.js');
  try {
    const user = await getUser(row.user_id);
    return user.email;
  } catch {
    return null;
  }
}
