import { query, transaction } from '../db';
import { BillingUnreachable, ensureCatalog, ensureSubscription, ensureTenant, postUsage } from '../services/killbill';
import { sealWindows } from '../domain/usage';
import { nowSecond } from '../http/core';

export interface SyncResult {
  sealed: number;
  posted: number;
  queued: number;
  state: 'in_sync' | 'pending' | 'delayed';
}

async function markAttempt(error: string | null): Promise<void> {
  await query('update billing_status set last_attempt_at = now(), last_error = $1, reachable = $2 where id = 1', [
    error,
    error === null,
  ]);
}

async function subscriptionFor(slug: string, name: string, planId: string): Promise<string> {
  const cached = await query<{ subscription_id: string | null }>(
    'select subscription_id from billing_accounts where workspace_slug = $1',
    [slug],
  );
  if (cached.length > 0 && cached[0].subscription_id) return cached[0].subscription_id;
  const subscription = await ensureSubscription(slug, name, planId);
  await query(
    `insert into billing_accounts (workspace_slug, account_id, subscription_id, created_at)
     values ($1, $2, $3, now())
     on conflict (workspace_slug) do update set account_id = $2, subscription_id = $3`,
    [slug, subscription.accountId, subscription.subscriptionId],
  );
  return subscription.subscriptionId;
}

/** Seals usage windows and posts every sealed, unposted row exactly once. */
export async function syncBilling(manual: boolean): Promise<SyncResult> {
  const sealed = await transaction(async (client) => sealWindows(client, nowSecond(), manual));
  let posted = 0;
  let failure: string | null = null;
  try {
    await ensureTenant();
    await ensureCatalog();
    const queued = await query<{
      id: string;
      workspace_slug: string;
      workspace_name: string;
      plan_id: string;
      bucket: string;
      unit: string;
      window_start: string;
      amount: string;
      tracking_id: string;
    }>(
      `select u.id, u.workspace_slug, w.name as workspace_name, w.plan_id, u.bucket, u.unit, u.window_start,
              u.amount::text as amount, u.tracking_id
       from usage_rows u join workspaces w on w.slug = u.workspace_slug
       where u.sealed and u.billing_state <> 'posted' order by u.window_start limit 200`,
    );
    for (const usageRow of queued) {
      const subscriptionId = await subscriptionFor(usageRow.workspace_slug, usageRow.workspace_name, usageRow.plan_id);
      const outcome = await postUsage({
        subscriptionId,
        trackingId: usageRow.tracking_id,
        unit: usageRow.unit,
        recordDate: new Date(usageRow.window_start).toISOString().slice(0, 10),
        amount: usageRow.amount,
      });
      if (outcome === 'posted' || outcome === 'already-recorded') {
        await query("update usage_rows set billing_state = 'posted' where id = $1 and billing_state <> 'posted'", [usageRow.id]);
        posted += 1;
      }
    }
  } catch (error) {
    failure = error instanceof BillingUnreachable ? error.message : (error as Error).message;
  }
  await markAttempt(failure);
  const remaining = await query<{ count: string }>(
    "select count(*)::text as count from usage_rows where sealed and billing_state <> 'posted'",
  );
  const queuedRows = Number(remaining[0]?.count ?? '0');
  const state: SyncResult['state'] = failure !== null ? 'delayed' : queuedRows > 0 ? 'pending' : 'in_sync';
  return { sealed, posted, queued: queuedRows, state };
}

export async function billingTick(): Promise<void> {
  try {
    await syncBilling(false);
  } catch {
    /* a dependency is down; the next tick retries */
  }
}
