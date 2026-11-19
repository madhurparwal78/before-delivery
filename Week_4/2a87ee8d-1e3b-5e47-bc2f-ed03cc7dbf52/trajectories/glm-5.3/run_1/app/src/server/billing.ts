/**
 * Billing: the Kill Bill mirror, plan changes, overdue payment state and the
 * facilitator account seeding (DP-46 to DP-52).
 */
import type { PoolClient } from 'pg';
import type { Config } from './config.js';
import { KillBillClient, type KbSubscription } from './killbill.js';
import { ENTITLEMENTS, PLAN_PRICES, type PlanCode, type TermCode } from '../domain.js';
import { centsToAmount, kbAmountToCents } from './money.js';
import { dateKey } from './time.js';

export interface BillingEntitlements {
  activeWorkshops: number | null;
  participantsPerWorkshop: number;
  silentRoundsPerWorkshop: number | null;
  invitesPerDay: number;
  recapScale: 1 | 2;
}

export interface MirrorInvoice {
  id: string; number: string; date: string; cents: number; balanceCents: number;
  currency: string; status: 'paid' | 'unpaid';
}

export interface BillingMirror {
  plan: PlanCode; term: TermCode; state: 'active' | 'past_due' | 'read_only';
  pastDueSince: string | null; readOnlyAt: string | null; renewsOn: string;
  pendingChange: { plan: PlanCode; term: TermCode; effectiveDate: string } | null;
  entitlements: BillingEntitlements;
  invoices: MirrorInvoice[];
  stale: boolean; syncedAt: string;
}

const AUTO_PAY_OFF = '00000000-0000-0000-0000-000000000001';

function planFromName(planName: string): { plan: PlanCode; term: TermCode } | null {
  const m = /^(free|studio|agency)-(monthly|annual)$/.exec(planName);
  if (!m) return null;
  return { plan: m[1] as PlanCode, term: m[2] as TermCode };
}

/** The plan-change policy, decided once (DP-47, DP-48): immediate on a rank rise
 * or monthly→annual at the same rank, scheduled otherwise. */
export function changeIsImmediate(fromPlan: PlanCode, fromTerm: TermCode, toPlan: PlanCode, toTerm: TermCode): boolean {
  const rank = (p: PlanCode): number => (p === 'free' ? 0 : p === 'studio' ? 1 : 2);
  if (rank(toPlan) > rank(fromPlan)) return true;
  return rank(toPlan) === rank(fromPlan) && fromTerm === 'monthly' && toTerm === 'annual';
}

/** Make sure the facilitator's Kill Bill account exists with one subscription. */
export async function ensureFacilitatorAccount(kb: KillBillClient, fac: { id: string; email: string; name: string; time_zone: string }, currentPlan: PlanCode, currentTerm: TermCode): Promise<string> {
  const key = `facilitator:${fac.email}`;
  let account = await kb.getAccountByKey(key);
  if (!account) {
    account = await kb.createAccount({
      externalKey: key, name: fac.name, email: fac.email, currency: 'EUR', timeZone: fac.time_zone,
    });
    await kb.addExternalPaymentMethod(account.accountId);
    await kb.addAutoPayOffTag(account.accountId);
    await kb.createSubscription(account.accountId, `${currentPlan}-${currentTerm}`, `sub-${fac.id}`);
    // the initial subscription invoice is paid at once, as auto-pay would have;
    // later invoices (for example upgrades) stay unpaid under the control tag
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const invoices = await kb.getInvoicesWithItems(account.accountId);
      if (invoices.length > 0) {
        for (const inv of invoices) {
          if (inv.balance > 0) {
            await kb.payInvoice(account.accountId, inv.invoiceId, Math.round(inv.balance * 100), `seed-${inv.invoiceId}`).catch(() => undefined);
          }
        }
        break;
      }
    }
  }
  const subs = await kb.getSubscriptions(account.accountId);
  if (subs.length === 0) {
    await kb.createSubscription(account.accountId, `${currentPlan}-${currentTerm}`, `sub-${fac.id}`);
  }
  return account.accountId;
}

/** Refresh the billing mirror from Kill Bill (DP-46). Returns stale=true on outage. */
export async function refreshMirror(
  kb: KillBillClient,
  cfg: Config,
  c: PoolClient,
  fac: { id: string; email: string; name: string; time_zone: string },
): Promise<boolean> {
  const mirror = (await c.query('select * from billing_mirror where facilitator_id = $1', [fac.id])).rows[0] as
    | { plan: string; term: string; renews_on: string; state: string; past_due_since: Date | null; kb_account_id: string | null }
    | undefined;
  const seedPlan = (mirror?.plan ?? 'free') as PlanCode;
  const seedTerm = (mirror?.term ?? 'monthly') as TermCode;
  let accountId = mirror?.kb_account_id ?? null;
  try {
    if (!accountId) {
      accountId = await ensureFacilitatorAccount(kb, fac, seedPlan, seedTerm);
    }
    const subs: KbSubscription[] = await kb.getSubscriptions(accountId);
    const active = subs.filter((s) => s.state === 'ACTIVE' || s.state === 'BLOCKED')[0] ?? subs[0];
    let plan: PlanCode = 'free';
    let term: TermCode = 'monthly';
    let renewsOn = mirror?.renews_on ?? dateKey(new Date(), fac.time_zone);
    let pendingChange: { plan: PlanCode; term: TermCode; effectiveDate: string } | null = null;
    if (active) {
      const current = planFromName(active.planName);
      if (current) { plan = current.plan; term = current.term; }
      renewsOn = active.chargedThroughDate ?? renewsOn;
      // a scheduled future CHANGE event is the pending change
      const now = Date.now();
      const future = (active.events ?? []).find((e) => e.eventType === 'CHANGE' && e.plan && e.plan !== active.planName && Date.parse(e.effectiveDate) > now);
      if (future && future.plan) {
        const target = planFromName(future.plan);
        if (target) pendingChange = { plan: target.plan, term: target.term, effectiveDate: future.effectiveDate.slice(0, 10) };
      }
    }
    const invoices: MirrorInvoice[] = [];
    let totalBalance = 0;
    for (const inv of await kb.getInvoicesWithItems(accountId)) {
      const cents = kbAmountToCents(inv.amount);
      const balance = kbAmountToCents(inv.balance);
      totalBalance += balance;
      invoices.push({
        id: inv.invoiceId, number: String(inv.invoiceNumber), date: inv.invoiceDate,
        cents, balanceCents: balance, currency: inv.currency,
        status: balance > 0 ? 'unpaid' : 'paid',
      });
    }
    invoices.reverse(); // newest first
    const pastDueSince = totalBalance > 0 ? (mirror?.past_due_since ?? new Date()) : null;
    const readOnlyAt = pastDueSince ? new Date(pastDueSince.getTime() + cfg.paymentGraceSeconds * 1000) : null;
    const state = totalBalance > 0 ? (readOnlyAt && readOnlyAt.getTime() <= Date.now() ? 'read_only' : 'past_due') : 'active';
    await c.query(
      `update billing_mirror set plan=$1, term=$2, renews_on=$3, state=$4, past_due_since=$5, read_only_at=$6,
       pending_change=$7, entitlements=$8, stale=false, synced_at=now(), kb_account_id=$9 where facilitator_id=$10`,
      [plan, term, renewsOn, state, pastDueSince, readOnlyAt,
        pendingChange ? JSON.stringify(pendingChange) : null,
        JSON.stringify(ENTITLEMENTS[plan]), accountId, fac.id]);
    for (const inv of invoices) {
      await c.query(
        `insert into kb_invoices (id, facilitator_id, number, date, cents, balance_cents, currency, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do update set balance_cents = $6`,
        [inv.id, fac.id, inv.number, inv.date, inv.cents, inv.balanceCents, inv.currency, inv.status]);
    }
    return false;
  } catch (e) {
    console.error('[billing] refresh failed for', fac.email, e instanceof Error ? e.message : e);
    await c.query('update billing_mirror set stale = true where facilitator_id = $1', [fac.id]);
    return true;
  }
}

/** Read the mirror as the billing object (from Postgres, honouring staleness). */
export async function readMirror(c: PoolClient, facilitatorId: string): Promise<BillingMirror | null> {
  const mirror = (await c.query('select * from billing_mirror where facilitator_id = $1', [facilitatorId])).rows[0] as
    | {
      plan: string; term: string; renews_on: string; state: string;
      past_due_since: Date | null; read_only_at: Date | null; pending_change: unknown;
      entitlements: unknown; stale: boolean; synced_at: Date | null;
    }
    | undefined;
  if (!mirror) return null;
  const invoiceRows = (await c.query('select * from kb_invoices where facilitator_id = $1 order by date desc, number desc', [facilitatorId])).rows as Array<{
    id: string; number: string; date: string; cents: number; balance_cents: number; currency: string; status: string;
  }>;
  const entitlements = mirror.entitlements as BillingEntitlements;
  return {
    plan: mirror.plan as PlanCode,
    term: mirror.term as TermCode,
    state: mirror.state as BillingMirror['state'],
    pastDueSince: mirror.past_due_since?.toISOString() ?? null,
    readOnlyAt: mirror.read_only_at?.toISOString() ?? null,
    renewsOn: mirror.renews_on,
    pendingChange: (mirror.pending_change as BillingMirror['pendingChange']) ?? null,
    entitlements,
    invoices: invoiceRows.map((r) => ({
      id: r.id, number: r.number, date: r.date, cents: r.cents,
      balanceCents: r.balance_cents, currency: r.currency,
      status: r.balance_cents > 0 ? 'unpaid' as const : 'paid' as const,
    })),
    stale: mirror.stale,
    syncedAt: mirror.synced_at?.toISOString() ?? new Date(0).toISOString(),
  };
}

export function billingObject(m: BillingMirror, usage: { activeWorkshops: number; invitesToday: number }): Record<string, unknown> {
  return {
    usage: { activeWorkshops: usage.activeWorkshops, invitesToday: usage.invitesToday },
    plan: m.plan,
    term: m.term,
    state: m.state,
    pastDueSince: m.pastDueSince,
    readOnlyAt: m.readOnlyAt,
    renewsOn: m.renewsOn,
    pendingChange: m.pendingChange,
    entitlements: m.entitlements,
    invoices: m.invoices.map((i) => ({
      id: i.id, number: i.number, date: i.date,
      amount: centsToAmount(i.cents), balance: centsToAmount(i.balanceCents),
      currency: i.currency, status: i.status,
    })),
    stale: m.stale,
    syncedAt: m.syncedAt,
  };
}

export function priceFor(plan: PlanCode, term: TermCode): string {
  return PLAN_PRICES[plan][term];
}
