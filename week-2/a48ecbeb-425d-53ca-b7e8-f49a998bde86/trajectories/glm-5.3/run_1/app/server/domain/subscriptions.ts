import { withClient, type DbClient } from '../db.js';
import {
  addSubscriptionBlockingState,
  cancelAtEndOfTerm,
  cancelImmediately,
  changePlan,
  getBlockingStates,
  getSubscription,
} from '../services/killbill.js';
import { addMonths, formatTorontoDate, torontoYmd } from './geo.js';

export const PLANS: Record<string, { label: string; cadence: string; flavourBox: Record<string, number> }> = {
  'ceibo-guava-lime-monthly': { label: 'Guava & Lime box', cadence: 'monthly', flavourBox: { 'guava-lime': 12 } },
  'ceibo-guava-lime-bimonthly': { label: 'Guava & Lime box', cadence: 'bimonthly', flavourBox: { 'guava-lime': 12 } },
  'ceibo-yuzu-ginger-monthly': { label: 'Yuzu Ginger box', cadence: 'monthly', flavourBox: { 'yuzu-ginger': 12 } },
  'ceibo-yuzu-ginger-bimonthly': { label: 'Yuzu Ginger box', cadence: 'bimonthly', flavourBox: { 'yuzu-ginger': 12 } },
  'ceibo-passionfruit-basil-monthly': { label: 'Passionfruit Basil box', cadence: 'monthly', flavourBox: { 'passionfruit-basil': 12 } },
  'ceibo-passionfruit-basil-bimonthly': { label: 'Passionfruit Basil box', cadence: 'bimonthly', flavourBox: { 'passionfruit-basil': 12 } },
  'ceibo-discovery-monthly': { label: 'Discovery box', cadence: 'monthly', flavourBox: { 'guava-lime': 4, 'yuzu-ginger': 4, 'passionfruit-basil': 4 } },
  'ceibo-discovery-bimonthly': { label: 'Discovery box', cadence: 'bimonthly', flavourBox: { 'guava-lime': 4, 'yuzu-ginger': 4, 'passionfruit-basil': 4 } },
};

export interface SubscriptionRow {
  id: string;
  user_id: string;
  kb_account_id: string;
  plan: string;
  plan_label: string;
  cadence: string;
  address: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    province: string;
    postal_code: string;
  };
  card: { brand: string; last4: string; behaviour: string; used: boolean; expiry_month: number; expiry_year: number };
  next_cycle: string;
  created_at: Date;
}

export interface ChangeRequestRow {
  id: string;
  subscription_id: string;
  kind: string;
  status: 'pending_provider' | 'applied' | 'rejected';
  effective_date: string;
  requested_at: Date;
  payload: Record<string, unknown>;
}

export interface DunningInfo {
  step: string;
  failed_at: string;
  next_retry_at: string | null;
  shipments_held: boolean;
  cancels_at: string;
}

export interface SubscriptionView {
  id: string;
  plan: string;
  plan_label: string;
  cadence: string;
  state: 'active' | 'paused' | 'past_due' | 'cancel_pending' | 'cancelled';
  next_renewal_date: string;
  billing_end_date: string | null;
  pause: { from: string; resumes_on: string } | null;
  skip: { date: string } | null;
  change_cutoff: string;
  changes_apply_to: string;
  pending_change: ChangeRequestRow | null;
  last_change: ChangeRequestRow | null;
  dunning: DunningInfo | null;
  card: { brand: string; last4: string };
}

export function ymd(value: Date | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function loadSubscriptionRow(id: string, client?: DbClient): Promise<SubscriptionRow | null> {
  const c = client ?? (await withClient(async (x) => x));
  const q = await c.query('select * from subscriptions where id = $1', [id]);
  const row = (q.rows[0] as unknown as SubscriptionRow) ?? null;
  if (row) row.next_cycle = ymd(row.next_cycle);
  return row;
}

export async function listSubscriptionRows(userId: string): Promise<SubscriptionRow[]> {
  return withClient(async (client) => {
    const q = await client.query('select * from subscriptions where user_id = $1 order by created_at desc', [userId]);
    const rows = q.rows as unknown as SubscriptionRow[];
    for (const row of rows) row.next_cycle = ymd(row.next_cycle);
    return rows;
  });
}

export function getPlan(id: string): { label: string; cadence: string; flavourBox: Record<string, number> } | null {
  return PLANS[id] ?? null;
}

export function periodMonthsOf(row: { cadence: string }): number {
  return row.cadence === 'monthly' ? 1 : 2;
}

interface CeiboStates {
  effectiveState: string | null;
  pause: { from: string; resumes_on: string } | null;
  skip: { date: string } | null;
  raw: { stateName: string; effectiveDate: string }[];
}

function resolveBlocking(
  states: { stateName: string; service: string; blockedId: string; effectiveDate: string }[],
  subscriptionId: string,
  periodMonths: number
): CeiboStates {
  const ceibo = states
    .filter((s) => s.service === 'ceibo' && s.blockedId === subscriptionId)
    .map((s) => ({ stateName: s.stateName, effectiveDate: s.effectiveDate, sortKey: Date.parse(s.effectiveDate), index: 0 }));
  ceibo.sort((a, b) => a.sortKey - b.sortKey || a.index - b.index);
  const nowMs = Date.now();
  let effectiveNow: string | null = null;
  for (const s of ceibo) {
    if (s.sortKey <= nowMs) effectiveNow = s.stateName;
  }
  let pause: { from: string; resumes_on: string } | null = null;
  const pauseState = ceibo.find((s) => s.stateName === 'CEIBO_PAUSED');
  if (pauseState) {
    const from = ymd(pauseState.effectiveDate);
    pause = { from, resumes_on: addMonths(from, periodMonths) };
    const activeAfter = ceibo
      .filter((s) => s.sortKey > pauseState.sortKey && s.stateName === 'CEIBO_ACTIVE')
      .sort((a, b) => a.sortKey - b.sortKey)[0];
    if (activeAfter) {
      pause = { from, resumes_on: ymd(activeAfter.effectiveDate) };
    }
  }
  const skipState = ceibo.find((s) => s.stateName === 'CEIBO_SKIPPED');
  const skip = skipState ? { date: ymd(skipState.effectiveDate) } : null;
  return {
    effectiveState: effectiveNow,
    pause,
    skip,
    raw: ceibo.map((s) => ({ stateName: s.stateName, effectiveDate: s.effectiveDate })),
  };
}

export function cycleBlocked(raw: { stateName: string; effectiveDate: string }[], cycleDate: string): boolean {
  const cycleMs = Date.parse(`${cycleDate}T23:59:59.000Z`);
  let blocked = false;
  for (const s of raw) {
    if (Date.parse(s.effectiveDate) <= cycleMs) {
      blocked = s.stateName === 'CEIBO_PAUSED' || s.stateName === 'CEIBO_SKIPPED';
    }
  }
  return blocked;
}

export async function subscriptionView(
  row: SubscriptionRow,
  kbNow: Date,
  dunning: DunningInfo | null,
  pending: ChangeRequestRow | null,
  lastChange: ChangeRequestRow | null,
  changeCutoffHours: number
): Promise<SubscriptionView> {
  const sub = await getSubscription(row.id);
  const states = await getBlockingStates(row.kb_account_id);
  const periodMonths = periodMonthsOf(row);
  const blocking = resolveBlocking(states, row.id, periodMonths);
  const kbNowYmd = torontoYmd(kbNow);
  const firstCycle = row.next_cycle || addMonths(kbNowYmd, periodMonths);
  let nextRenewal = firstCycle;
  let guard = 0;
  while (guard < 60 && cycleBlocked(blocking.raw, nextRenewal)) {
    nextRenewal = addMonths(nextRenewal, periodMonths);
    guard++;
  }
  let state: SubscriptionView['state'];
  const cancelledDate = sub.cancelledDate;
  const dunningView = cancelledDate ? null : dunning;
  let billingEnd: string | null = null;
  let cancelledAt: number | null = null;
  if (cancelledDate) {
    const cancelledYmd = ymd(cancelledDate);
    const userCancel = lastChange?.kind === 'cancel' && lastChange.status === 'applied';
    if (userCancel && cancelledYmd <= ymd(row.created_at)) {
      billingEnd = firstCycle;
      cancelledAt = Date.parse(`${billingEnd}T23:59:59Z`);
    } else {
      billingEnd = cancelledYmd;
      cancelledAt = Date.parse(cancelledDate);
    }
  }
  if (cancelledAt !== null && cancelledAt <= kbNow.getTime()) {
    state = 'cancelled';
  } else if (cancelledDate) {
    state = 'cancel_pending';
  } else if (dunningView) {
    state = 'past_due';
  } else if (blocking.effectiveState === 'CEIBO_PAUSED') {
    state = 'paused';
  } else {
    state = 'active';
  }
  const pausedNow = state === 'paused';
  const resumeDate = blocking.pause?.resumes_on;
  const cutoffMs = Date.parse(`${nextRenewal}T00:00:00`) - changeCutoffHours * 3600 * 1000;
  const changesApplyTo = kbNow.getTime() < cutoffMs ? nextRenewal : addMonths(nextRenewal, periodMonths);
  return {
    id: row.id,
    plan: row.plan,
    plan_label: row.plan_label,
    cadence: row.cadence,
    state,
    next_renewal_date: pausedNow && resumeDate ? resumeDate : nextRenewal,
    billing_end_date: billingEnd,
    pause: blocking.pause,
    skip: blocking.skip,
    change_cutoff: torontoYmd(new Date(cutoffMs)),
    changes_apply_to: changesApplyTo,
    pending_change: pending,
    last_change: lastChange,
    dunning: dunningView,
    card: { brand: row.card.brand, last4: row.card.last4 },
  };
}

export async function readChanges(subscriptionId: string, client?: DbClient): Promise<{
  pending: ChangeRequestRow | null;
  lastChange: ChangeRequestRow | null;
}> {
  const c = client ?? (await withClient(async (x) => x));
  const mapRow = (r: ChangeRequestRow): ChangeRequestRow => ({ ...r, effective_date: ymd(r.effective_date) });
  const pending = (await c.query(
    "select * from change_requests where subscription_id = $1 and status = 'pending_provider' order by requested_at desc limit 1",
    [subscriptionId]
  )).rows[0] as ChangeRequestRow | undefined;
  const lastChange = (await c.query(
    "select * from change_requests where subscription_id = $1 and status != 'pending_provider' order by requested_at desc limit 1",
    [subscriptionId]
  )).rows[0] as ChangeRequestRow | undefined;
  return {
    pending: pending ? mapRow(pending) : null,
    lastChange: lastChange ? mapRow(lastChange) : null,
  };
}

export async function readDunning(subscriptionId: string, client?: DbClient): Promise<DunningInfo | null> {
  const c = client ?? (await withClient(async (x) => x));
  const steps = (await c.query<{ step: string; due_at: Date; status: string }>(
    'select step, due_at, status from dunning_steps where subscription_id = $1 order by due_at',
    [subscriptionId]
  )).rows;
  if (steps.length === 0) return null;
  if (steps.every((s) => s.status === 'dropped')) return null;
  const pending = steps.find((s) => s.status === 'pending');
  const latestDone = [...steps].filter((s) => s.status === 'done').pop();
  return {
    step: latestDone?.step ?? 'day0',
    failed_at: steps[0].due_at.toISOString(),
    next_retry_at: pending ? pending.due_at.toISOString() : null,
    shipments_held: steps.some((s) => s.status === 'done' && (s.step === 'hold' || s.step === 'cancel')),
    cancels_at: steps[steps.length - 1].due_at.toISOString(),
  };
}

export type ChangeKind = 'pause' | 'resume' | 'skip' | 'swap' | 'cancel';

export async function applyChangeToKillBill(
  kind: ChangeKind,
  row: SubscriptionRow,
  view: SubscriptionView,
  payload: Record<string, unknown>
): Promise<void> {
  const periodMonths = periodMonthsOf(row);
  if (kind === 'pause') {
    const cycles = Number(payload.cycles ?? 1);
    const from = view.changes_apply_to;
    const resume = addMonths(from, periodMonths * cycles);
    await addSubscriptionBlockingState(row.id, 'CEIBO_PAUSED', from, true);
    await addSubscriptionBlockingState(row.id, 'CEIBO_ACTIVE', resume, false);
  } else if (kind === 'resume') {
    await addSubscriptionBlockingState(row.id, 'CEIBO_ACTIVE', torontoYmd(new Date()), false);
    if (view.pause) {
      await addSubscriptionBlockingState(row.id, 'CEIBO_ACTIVE', view.pause.from, false);
    }
  } else if (kind === 'skip') {
    const from = view.changes_apply_to;
    await addSubscriptionBlockingState(row.id, 'CEIBO_SKIPPED', from, true);
    await addSubscriptionBlockingState(row.id, 'CEIBO_ACTIVE', addMonths(from, periodMonths), false);
  } else if (kind === 'swap') {
    await changePlan(row.id, String(payload.plan));
  } else if (kind === 'cancel') {
    await cancelAtEndOfTerm(row.id);
  }
}

export async function dunningCancel(row: SubscriptionRow): Promise<void> {
  await cancelImmediately(row.id);
}

export function changeStateText(view: SubscriptionView): string {
  switch (view.state) {
    case 'active':
      return 'Active';
    case 'paused':
      if (view.pause) {
        return `Pause scheduled from ${formatTorontoDate(view.pause.from)}, resumes ${formatTorontoDate(view.pause.resumes_on)}`;
      }
      return 'Paused';
    case 'past_due':
      return 'Payment overdue';
    case 'cancel_pending':
      return `Ends on ${view.billing_end_date ? formatTorontoDate(view.billing_end_date) : ''}`;
    case 'cancelled':
      return 'Cancelled';
  }
}

export async function advanceNextCycle(subscriptionId: string, periodMonths: number): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      'update subscriptions set next_cycle = next_cycle + make_interval(months => $2) where id = $1',
      [subscriptionId, periodMonths]
    );
  });
}
