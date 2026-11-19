import { query } from './db/pool.js';
import { currentPeriod, monthKey } from './domain/quota.js';
import { onSettleBilling, writeMachineTranscript } from './engine.js';
import {
  billingReachable,
  changeSubscriptionPlan,
  ensureAccount,
  isBillingUnreachable,
  readSubscriptionPlan,
  recordUsage,
} from './services/killbill.js';
import { catalogPlanName } from './services/catalog.js';
import { loadOrg, loadSession, type ProjectRow } from './store.js';
import { costCents } from '../shared/billing.js';
import type { Plan, UsageProject, UsageView } from '../shared/types.js';

const RETRY_MS = 5_000;

/** Each closed billable session is recorded exactly once as usage on its subscription. */
export const settleSessionUsage = async (sessionId: string): Promise<void> => {
  const session = await loadSession(sessionId);
  if (session === null || session.billing_state !== 'pending' || session.billable_seconds === null) return;
  if (session.ended_at === null) return;
  const org = await loadOrg(session.org_id);
  if (org === null) return;
  const subscriptionId = org.kb_subscription_id ?? (await ensureOrgAccount(org.id)).subscriptionId;
  const accepted = await recordUsage(subscriptionId, session.id, session.billable_seconds, session.ended_at);
  if (accepted)
    await query("update sessions set billing_state = 'confirmed' where id = $1 and billing_state = 'pending'", [
      session.id,
    ]);
};

export interface OrgBillingLink {
  readonly accountId: string;
  readonly subscriptionId: string;
}

/** Accounts and subscriptions are looked up by external key and created if missing. */
export const ensureOrgAccount = async (orgId: string): Promise<OrgBillingLink> => {
  const org = await loadOrg(orgId);
  if (org === null) throw new Error(`unknown organisation ${orgId}`);
  if (org.kb_account_id !== null && org.kb_subscription_id !== null)
    return { accountId: org.kb_account_id, subscriptionId: org.kb_subscription_id };
  const link = await ensureAccount(org.name, org.slug, org.plan);
  await query('update orgs set kb_account_id = $2, kb_subscription_id = $3 where id = $1', [
    orgId,
    link.accountId,
    link.subscriptionId,
  ]);
  return link;
};

/** A plan change is confirmed or failed only by Kill Bill's answer. */
export const drivePlanChange = async (changeId: string): Promise<void> => {
  const rows = await query<{ id: string; org_id: string; target: Plan; state: string }>(
    'select id, org_id, target, state from plan_changes where id = $1',
    [changeId],
  );
  const change = rows[0];
  if (change === undefined || change.state !== 'requested') return;
  try {
    const link = await ensureOrgAccount(change.org_id);
    const changed = await changeSubscriptionPlan(link.subscriptionId, change.target);
    const readBack = changed ? await readSubscriptionPlan(link.subscriptionId) : null;
    if (readBack === catalogPlanName[change.target]) {
      await query('update orgs set plan = $2 where id = $1', [change.org_id, change.target]);
      await query("update plan_changes set state = 'confirmed', decided_at = now() where id = $1", [changeId]);
      return;
    }
    await query("update plan_changes set state = 'failed', decided_at = now() where id = $1", [changeId]);
  } catch (error) {
    if (!isBillingUnreachable(error)) throw error;
  }
};

interface UsageSessionRow {
  project_id: string;
  plan: Plan;
  billable_seconds: number;
  billing_state: 'pending' | 'confirmed';
}

/**
 * Per project, per plan, per current UTC month: billable seconds summed, then one
 * rounding step to integer cents.
 */
export const usageView = async (projects: readonly ProjectRow[], now: Date): Promise<UsageView> => {
  const period = currentPeriod(now);
  const rows =
    projects.length === 0
      ? []
      : await query<UsageSessionRow>(
          `select project_id, plan, billable_seconds, billing_state from sessions
            where project_id = any($1::uuid[]) and ended_at >= $2 and ended_at < $3
              and billing_state in ('pending','confirmed')`,
          [projects.map((project) => project.id), period.start, period.resets],
        );

  const byProject = new Map<string, UsageSessionRow[]>();
  for (const project of projects) byProject.set(project.id, []);
  for (const row of rows) byProject.get(row.project_id)?.push(row);

  const views: UsageProject[] = projects.map((project) => {
    const own = byProject.get(project.id) ?? [];
    const plans: Plan[] = ['pilot', 'scale'];
    const byPlan = plans
      .map((plan) => {
        const seconds = own
          .filter((row) => row.plan === plan)
          .reduce((total, row) => total + row.billable_seconds, 0);
        return { plan, billable_seconds: seconds, cost_cents: costCents(plan, seconds) };
      })
      .filter((entry) => entry.billable_seconds > 0);
    const pending = own.filter((row) => row.billing_state === 'pending').length;
    return {
      project_id: project.id,
      name: project.name,
      sessions: own.length,
      billable_seconds: own.reduce((total, row) => total + row.billable_seconds, 0),
      cost_cents: byPlan.reduce((total, entry) => total + entry.cost_cents, 0),
      billing_state: pending > 0 ? 'pending' : 'confirmed',
      pending_sessions: pending,
      by_plan: byPlan,
    };
  });

  return {
    month: monthKey(now),
    billing_reachable: await billingReachable(),
    org_total_cents: views.reduce((total, view) => total + view.cost_cents, 0),
    projects: views,
  };
};

const retryPending = async (): Promise<void> => {
  const pending = await query<{ id: string }>("select id from sessions where billing_state = 'pending' limit 50");
  for (const row of pending) await settleSessionUsage(row.id).catch(() => undefined);
  const changes = await query<{ id: string }>("select id from plan_changes where state = 'requested'");
  for (const row of changes) await drivePlanChange(row.id).catch(() => undefined);
  const missing = await query<{ id: string }>(
    'select id from sessions where ended_at is not null and transcript_written = false limit 50',
  );
  for (const row of missing) await writeMachineTranscript(row.id).catch(() => undefined);
};

export const startBillingWorker = (): void => {
  onSettleBilling(settleSessionUsage);
  setInterval(() => {
    void retryPending().catch(() => undefined);
  }, RETRY_MS);
};

export const ensureAllOrgAccounts = async (): Promise<void> => {
  const orgs = await query<{ id: string }>('select id from orgs');
  for (const org of orgs) await ensureOrgAccount(org.id).catch(() => undefined);
};
