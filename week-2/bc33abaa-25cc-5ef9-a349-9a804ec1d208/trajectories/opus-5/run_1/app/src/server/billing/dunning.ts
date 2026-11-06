import { query } from '../db/pool';
import { graceEndFrom } from '../domain/time';
import { SCHEDULER_ACTOR, SubscriptionRow, getSubscription, getWorkspace, writeAudit } from '../domain/workspace';
import { sendDunningNotice, unpaidInvoices, updateSubscriptionRow } from './engine';

/** A failed settlement moves an active subscription to past due and starts dunning. */
export async function markPastDue(workspaceId: string, invoiceId: string): Promise<void> {
  const subscription = await getSubscription(workspaceId);
  if (subscription.state !== 'active') return;
  const failedAt = new Date();
  await updateSubscriptionRow(workspaceId, {
    state: 'past_due',
    failed_at: failedAt,
    grace_ends_at: graceEndFrom(failedAt),
  });
  await writeAudit({
    workspaceId,
    actor: SCHEDULER_ACTOR,
    action: 'subscription.past_due',
    target: { type: 'subscription', id: workspaceId },
  });
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return;
  const invoice = await query<{ number: string }>(
    `SELECT number FROM invoice_records WHERE id = $1`,
    [invoiceId],
  );
  await sendDunningNotice({
    workspace,
    step: 0,
    invoiceNumber: invoice[0]?.number ?? invoiceId,
    graceEndsAt: graceEndFrom(failedAt),
  });
  await query(
    `INSERT INTO dunning_notices (workspace_id, failed_at, step) VALUES ($1, $2, 0)
     ON CONFLICT DO NOTHING`,
    [workspaceId, failedAt],
  );
}

/** Settling the last unpaid invoice brings the workspace back to active. */
export async function reactivateIfSettled(
  workspaceId: string,
  accountId: string,
): Promise<SubscriptionRow> {
  const subscription = await getSubscription(workspaceId);
  if (
    subscription.state !== 'past_due' &&
    !(subscription.state === 'suspended' && subscription.suspended_reason === 'dunning')
  ) {
    return subscription;
  }
  const outstanding = await unpaidInvoices(accountId);
  if (outstanding.length > 0) return subscription;
  const updated = await updateSubscriptionRow(workspaceId, {
    state: 'active',
    failed_at: null,
    grace_ends_at: null,
    suspended_reason: null,
  });
  await writeAudit({
    workspaceId,
    actor: SCHEDULER_ACTOR,
    action: 'subscription.reactivated',
    target: { type: 'subscription', id: workspaceId },
  });
  return updated;
}
