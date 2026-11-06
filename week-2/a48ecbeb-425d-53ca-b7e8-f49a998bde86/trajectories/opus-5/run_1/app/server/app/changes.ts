import { findPlan } from '../../shared/catalogue.js';
import { apiMessages, subscriptionCopy } from '../../shared/copy.js';
import {
  addCycles,
  changesApplyTo,
  isChangeLegal,
  swapProblem,
  type ChangeRequest,
} from '../../shared/subscription.js';
import { billingDate } from '../../shared/time.js';
import { queueMail } from '../db/outbox.js';
import {
  claimPendingChanges,
  findSubscription,
  insertChangeRequest,
  pendingChange,
  releaseChangeClaim,
  settleChangeRequest,
  type ChangeRequestRecord,
  type SubscriptionRecord,
} from '../db/subscriptions.js';
import { query } from '../db/pool.js';
import { env } from '../env.js';
import { conflict, validationError } from '../http/errors.js';
import {
  blockSubscription,
  cancelEndOfTerm,
  changePlan,
  killBillNow,
  type KbSubscription,
} from '../services/killbill.js';
import {
  cancelAppliedMail,
  pauseAppliedMail,
  skipAppliedMail,
  swapAppliedMail,
} from './emails.js';
import { readSubscription, type SubscriptionReading } from './subscriptionView.js';

export function readChangeRequest(body: unknown): ChangeRequest {
  const payload = (body ?? {}) as Record<string, unknown>;
  switch (payload.kind) {
    case 'pause': {
      const cycles = payload.cycles;
      if (typeof cycles !== 'number' || !Number.isInteger(cycles) || cycles < 1 || cycles > 3) {
        throw validationError({ cycles: 'Pause for 1, 2 or 3 boxes.' });
      }
      return { kind: 'pause', cycles };
    }
    case 'resume':
      return { kind: 'resume' };
    case 'skip':
      return { kind: 'skip' };
    case 'swap': {
      if (typeof payload.plan !== 'string') {
        throw validationError({ plan: subscriptionCopy.swapFields.unknownPlan });
      }
      return { kind: 'swap', plan: payload.plan };
    }
    case 'cancel':
      return { kind: 'cancel' };
    default:
      throw validationError({ kind: 'Pick a change to make.' });
  }
}

interface PlannedChange {
  effectiveDate: string | null;
  submit: () => Promise<void>;
}

function planChange(
  record: SubscriptionRecord,
  reading: SubscriptionReading,
  request: ChangeRequest,
  now: Date,
): PlannedChange {
  const { facts, payload, killBill } = reading;
  const applyTo =
    facts.nextRenewalDate === null
      ? billingDate(now)
      : changesApplyTo(facts.nextRenewalDate, facts.cadence, env.timing.changeCutoffHours, now);

  switch (request.kind) {
    case 'pause': {
      const resumes = addCycles(applyTo, facts.cadence, request.cycles);
      return {
        effectiveDate: applyTo,
        submit: async () => {
          await blockSubscription({
            subscriptionId: record.id,
            stateName: 'CEIBO_PAUSED',
            blocking: true,
            requestedDate: applyTo,
          });
          await blockSubscription({
            subscriptionId: record.id,
            stateName: 'CEIBO_ACTIVE',
            blocking: false,
            requestedDate: resumes,
          });
        },
      };
    }
    case 'skip': {
      const resumes = addCycles(applyTo, facts.cadence, 1);
      return {
        effectiveDate: applyTo,
        submit: async () => {
          await blockSubscription({
            subscriptionId: record.id,
            stateName: 'CEIBO_SKIPPED',
            blocking: true,
            requestedDate: applyTo,
          });
          await blockSubscription({
            subscriptionId: record.id,
            stateName: 'CEIBO_ACTIVE',
            blocking: false,
            requestedDate: resumes,
          });
        },
      };
    }
    case 'resume': {
      // A pause that has not started is removed by an active state on its own
      // from-date, which Kill Bill keeps after the pause and so overrides it.
      const from = payload.pause?.from ?? billingDate(now);
      const effective = facts.pauseScheduled ? from : billingDate(now);
      return {
        effectiveDate: effective,
        submit: () =>
          blockSubscription({
            subscriptionId: record.id,
            stateName: 'CEIBO_ACTIVE',
            blocking: false,
            requestedDate: effective,
          }),
      };
    }
    case 'swap':
      return {
        effectiveDate: applyTo,
        submit: () =>
          changePlan({
            subscriptionId: record.id,
            planName: request.plan,
            requestedDate: applyTo,
          }),
      };
    case 'cancel':
      return {
        effectiveDate: killBill.chargedThroughDate,
        submit: () => cancelEndOfTerm(record.id),
      };
  }
}

/** The one place a change request is checked, recorded and sent to Kill Bill. */
export async function requestChange(
  record: SubscriptionRecord,
  reading: SubscriptionReading,
  request: ChangeRequest,
): Promise<ChangeRequestRecord> {
  if ((await pendingChange(record.id)) !== null) {
    throw conflict('change_pending', apiMessages.changePending);
  }
  if (!isChangeLegal(reading.facts, request)) {
    throw conflict('illegal_change', apiMessages.illegalChange);
  }
  if (request.kind === 'swap') {
    const problem = swapProblem(reading.facts, request.plan);
    if (problem === 'unknown_plan') {
      throw validationError({ plan: subscriptionCopy.swapFields.unknownPlan });
    }
    if (problem === 'different_cadence') {
      throw validationError({ plan: subscriptionCopy.swapFields.differentCadence });
    }
  }

  const planned = planChange(record, reading, request, await killBillNow());
  const change = await insertChangeRequest({
    subscriptionId: record.id,
    kind: request.kind,
    cycles: request.kind === 'pause' ? request.cycles : null,
    plan: request.kind === 'swap' ? request.plan : null,
    effectiveDate: planned.effectiveDate,
  });
  try {
    await planned.submit();
  } catch (error) {
    await query('delete from change_requests where id = $1', [change.id]);
    throw error;
  }
  return change;
}

/** Reads Kill Bill back and only then shows a change as applied. */
function changeIsVisible(
  change: ChangeRequestRecord,
  reading: SubscriptionReading,
  killBill: KbSubscription,
): boolean {
  switch (change.kind) {
    case 'pause':
      return reading.payload.pause?.from === change.effective_date;
    case 'skip':
      return reading.payload.skip?.date === change.effective_date;
    case 'resume':
      return !reading.facts.pauseScheduled && reading.payload.state !== 'paused';
    case 'swap':
      return (
        killBill.planName === change.plan ||
        killBill.events.some(
          (event) => event.plan === change.plan && event.eventType === 'CHANGE',
        )
      );
    case 'cancel':
      return killBill.billingEndDate !== null;
    default:
      return false;
  }
}

function confirmationMail(
  record: SubscriptionRecord,
  change: ChangeRequestRecord,
  reading: SubscriptionReading,
) {
  switch (change.kind) {
    case 'pause':
      return reading.payload.pause === null
        ? null
        : pauseAppliedMail(record, reading.payload.pause.from, reading.payload.pause.resumes_on);
    case 'skip':
      return reading.payload.skip === null
        ? null
        : skipAppliedMail(record, reading.payload.skip.date);
    case 'swap':
      return swapAppliedMail(
        record,
        findPlan(change.plan ?? '')?.label ?? (change.plan ?? ''),
        change.effective_date ?? '',
      );
    case 'cancel':
      return reading.payload.billing_end_date === null
        ? null
        : cancelAppliedMail(record, reading.payload.billing_end_date);
    default:
      return null;
  }
}

const REJECT_AFTER_MS = 60_000;

/**
 * Confirms claimed change requests against Kill Bill. A change Kill Bill never
 * shows ends as rejected, and each confirmed change sends exactly one email.
 */
export async function confirmPendingChanges(): Promise<void> {
  for (const change of await claimPendingChanges()) {
    const record = await findSubscription(change.subscription_id);
    if (record === null) {
      await settleChangeRequest(change.id, 'rejected');
      continue;
    }
    let reading: SubscriptionReading | null;
    try {
      reading = await readSubscription(record);
    } catch (error) {
      await releaseChangeClaim(change.id);
      throw error;
    }
    if (reading === null) {
      await settleChangeRequest(change.id, 'rejected');
      continue;
    }

    if (changeIsVisible(change, reading, reading.killBill)) {
      await settleChangeRequest(change.id, 'applied');
      const mail = confirmationMail(record, change, reading);
      if (mail !== null) await queueMail(mail);
      continue;
    }
    if (Date.now() - new Date(change.requested_at).getTime() > REJECT_AFTER_MS) {
      await settleChangeRequest(change.id, 'rejected');
      continue;
    }
    await releaseChangeClaim(change.id);
  }
}
