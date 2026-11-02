import { type Cadence, findPlan } from '../../shared/catalogue.js';
import type { ChangeStatus, DunningStepName, SubscriptionFacts, SubscriptionState } from '../../shared/subscription.js';
import {
  DUNNING_SCHEDULE,
  changeCutoffInstant,
  changesApplyTo,
  dunningStepDueAt,
  nextDunningStep,
} from '../../shared/subscription.js';
import { billingDate, isoTimestamp } from '../../shared/time.js';
import {
  latestChange,
  openDunningRun,
  pendingChange,
  ranDunningSteps,
  type ChangeRequestRecord,
  type SubscriptionRecord,
} from '../db/subscriptions.js';
import { queryOne } from '../db/pool.js';
import { env } from '../env.js';
import {
  CEIBO_SERVICE,
  getInvoice,
  getSubscription,
  killBillNow,
  listBlockingStates,
  type KbBlockingState,
  type KbSubscription,
} from '../services/killbill.js';

export interface ChangePayload {
  id: string;
  kind: string;
  status: ChangeStatus;
  effective_date: string | null;
  requested_at: string;
}

export interface DunningPayload {
  step: DunningStepName;
  failed_at: string;
  next_retry_at: string | null;
  shipments_held: boolean;
  cancels_at: string;
}

export interface SubscriptionPayload {
  id: string;
  plan: string;
  plan_label: string;
  cadence: Cadence;
  state: SubscriptionState;
  next_renewal_date: string | null;
  billing_end_date: string | null;
  pause: { from: string; resumes_on: string } | null;
  skip: { date: string } | null;
  change_cutoff: string | null;
  changes_apply_to: string | null;
  pending_change: ChangePayload | null;
  last_change: ChangePayload | null;
  dunning: DunningPayload | null;
  card: { brand: string; last4: string };
}

function toChangePayload(change: ChangeRequestRecord | null): ChangePayload | null {
  if (change === null) return null;
  return {
    id: change.id,
    kind: change.kind,
    status: change.status,
    effective_date: change.effective_date,
    requested_at: change.requested_at,
  };
}

interface CeiboState {
  stateName: string;
  at: Date;
}

/**
 * The Ceibo blocking states in force order. Kill Bill keeps states with the same
 * effective date in the order they were added, and the last one wins, which is
 * how a resume cancels a pause that has not started yet.
 */
function ceiboStates(
  states: readonly KbBlockingState[],
  subscriptionId: string,
): CeiboState[] {
  return states
    .filter((state) => state.service === CEIBO_SERVICE && state.blockedId === subscriptionId)
    .map((state) => ({ stateName: state.stateName, at: new Date(state.effectiveDate) }));
}

function stateInForceAt(states: readonly CeiboState[], instant: Date): string | null {
  let current: string | null = null;
  for (const state of states) {
    if (state.at.getTime() <= instant.getTime()) current = state.stateName;
  }
  return current;
}

interface PauseAndSkip {
  paused: boolean;
  pause: { from: string; resumes_on: string } | null;
  skip: { date: string } | null;
  pauseScheduled: boolean;
  skipScheduled: boolean;
}

function readPauseAndSkip(states: readonly CeiboState[], now: Date): PauseAndSkip {
  const inForce = stateInForceAt(states, now);
  const result: PauseAndSkip = {
    paused: inForce === 'CEIBO_PAUSED',
    pause: null,
    skip: null,
    pauseScheduled: false,
    skipScheduled: false,
  };

  for (const [index, state] of states.entries()) {
    const overridden = states
      .slice(index + 1)
      .some((later) => later.at.getTime() <= state.at.getTime());
    if (overridden) continue;
    const ends = states[index + 1] ?? null;
    if (ends !== null && ends.at.getTime() <= now.getTime()) continue;

    if (state.stateName === 'CEIBO_PAUSED' && ends !== null) {
      result.pause = { from: billingDate(state.at), resumes_on: billingDate(ends.at) };
      result.pauseScheduled = state.at.getTime() > now.getTime();
    }
    if (state.stateName === 'CEIBO_SKIPPED') {
      result.skip = { date: billingDate(state.at) };
      result.skipScheduled = true;
    }
  }
  return result;
}

/** The open renewal invoice Kill Bill still shows as unpaid, if there is one. */
async function unpaidRenewalInvoice(subscriptionId: string): Promise<string | null> {
  const row = await queryOne<{ invoice_id: string }>(
    "select invoice_id from renewal_cycles where subscription_id = $1 and state = 'failed' order by claimed_at desc limit 1",
    [subscriptionId],
  );
  if (row === null) return null;
  const invoice = await getInvoice(row.invoice_id);
  return invoice.balance > 0 ? row.invoice_id : null;
}

async function dunningPayload(
  record: SubscriptionRecord,
  failedAt: Date,
  runId: string,
): Promise<DunningPayload> {
  const ran = await ranDunningSteps(runId);
  const lastStep: DunningStepName =
    [...DUNNING_SCHEDULE].reverse().find((entry) => ran.includes(entry.step))?.step ?? 'failed';
  const upcoming = nextDunningStep(lastStep);
  const nextRetry =
    upcoming !== null && upcoming.startsWith('retry')
      ? isoTimestamp(dunningStepDueAt(failedAt, upcoming, env.timing.dunningDaySeconds))
      : null;
  return {
    step: lastStep,
    failed_at: isoTimestamp(failedAt),
    next_retry_at: nextRetry,
    shipments_held: record.shipments_held,
    cancels_at: isoTimestamp(
      dunningStepDueAt(failedAt, 'cancelled', env.timing.dunningDaySeconds),
    ),
  };
}

export interface SubscriptionReading {
  payload: SubscriptionPayload;
  facts: SubscriptionFacts;
  killBill: KbSubscription;
}

/**
 * Builds the subscription the page and API show. Every state, date and pause is
 * read back from Kill Bill; only the card, the change requests and the dunning
 * timetable come from the shop's own store.
 */
export async function readSubscription(
  record: SubscriptionRecord,
): Promise<SubscriptionReading | null> {
  return readOne(record, await killBillNow(), await accountBlockingStates(record));
}

/**
 * Reads a list of subscriptions, taking the tenant clock and each account's
 * blocking states once rather than once per subscription.
 */
export async function readSubscriptions(
  records: readonly SubscriptionRecord[],
): Promise<SubscriptionPayload[]> {
  if (records.length === 0) return [];
  const now = await killBillNow();
  const accounts = [...new Set(records.map((record) => record.killbill_account_id))];
  const states = new Map(
    await Promise.all(
      accounts.map(
        async (accountId) =>
          [accountId, await listBlockingStates(accountId, 'SUBSCRIPTION')] as const,
      ),
    ),
  );
  const readings = await Promise.all(
    records.map((record) => readOne(record, now, states.get(record.killbill_account_id) ?? [])),
  );
  return readings
    .filter((reading): reading is SubscriptionReading => reading !== null)
    .map((reading) => reading.payload);
}

async function accountBlockingStates(
  record: SubscriptionRecord,
): Promise<KbBlockingState[]> {
  return listBlockingStates(record.killbill_account_id, 'SUBSCRIPTION');
}

async function readOne(
  record: SubscriptionRecord,
  now: Date,
  accountStates: readonly KbBlockingState[],
): Promise<SubscriptionReading | null> {
  const killBill = await getSubscription(record.id);
  if (killBill === null) return null;

  const states = ceiboStates(accountStates, record.id);
  const pauseAndSkip = readPauseAndSkip(states, now);

  const cadence: Cadence = record.cadence;
  const nextRenewalDate = killBill.chargedThroughDate;
  const billingEndDate =
    killBill.billingEndDate === null ? null : billingDate(new Date(killBill.billingEndDate));
  const cancelling = billingEndDate !== null;
  const cancelled = cancelling && billingEndDate! <= billingDate(now);

  const openInvoice = cancelled ? null : await unpaidRenewalInvoice(record.id);
  const run = await openDunningRun(record.id);

  const state: SubscriptionState = cancelled
    ? 'cancelled'
    : cancelling
      ? 'cancel_pending'
      : openInvoice !== null
        ? 'past_due'
        : pauseAndSkip.paused
          ? 'paused'
          : 'active';

  const cutoff =
    nextRenewalDate === null
      ? null
      : isoTimestamp(changeCutoffInstant(nextRenewalDate, env.timing.changeCutoffHours));
  const applyTo =
    nextRenewalDate === null
      ? null
      : changesApplyTo(nextRenewalDate, cadence, env.timing.changeCutoffHours, now);

  const plan = findPlan(killBill.planName);
  const pending = await pendingChange(record.id);
  const last = await latestChange(record.id);

  return {
    payload: {
      id: record.id,
      plan: killBill.planName,
      plan_label: plan?.label ?? killBill.planName,
      cadence,
      state,
      next_renewal_date: state === 'cancelled' ? null : nextRenewalDate,
      billing_end_date: billingEndDate,
      pause: pauseAndSkip.pause,
      skip: pauseAndSkip.skip,
      change_cutoff: cutoff,
      changes_apply_to: applyTo,
      pending_change: toChangePayload(pending),
      last_change: toChangePayload(last),
      dunning:
        state === 'past_due' && run !== null
          ? await dunningPayload(record, run.failed_at, run.id)
          : null,
      card: { brand: record.card_brand, last4: record.card_last4 },
    },
    facts: {
      state,
      plan: killBill.planName,
      cadence,
      nextRenewalDate,
      pauseScheduled: pauseAndSkip.pauseScheduled,
      skipScheduled: pauseAndSkip.skipScheduled,
    },
    killBill,
  };
}
