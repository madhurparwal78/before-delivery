// Plans, seats and the subscription lifecycle (Business rules › Plans and prices, Seats, Subscription lifecycle).
import type { PendingChange, Period, Plan, Subscription, SubscriptionState } from "../../shared/api-types.js";
import { isoSecond } from "../../shared/format.js";
import { PLAN_CATALOG as PLANS, TRIAL_SEATS } from "../../shared/plans.js";
import { one, pool, type Db } from "../db.js";
import { settleClock } from "./clock.js";
import { conflict, invalidTransition, workspaceReadOnly } from "../errors.js";

export const PERIODS: readonly Period[] = ["monthly", "annual"];
export const PLAN_IDS: readonly Plan[] = ["team", "business"];

export const killbillPlan = (plan: Plan, period: Period) => `${plan}-${period}`;
export const killbillSeatPlan = (plan: Plan, period: Period) => `seat-${plan}-${period}`;

export interface SubscriptionRow {
  workspace_id: string; state: SubscriptionState; plan: Plan; period: Period; extra_seats: number;
  trial_ends_at: Date | null; suspended_by: "trial" | "dunning" | null; failed_at: Date | null;
  dunning_day3_at: Date | null; dunning_day3_sent: boolean; grace_ends_at: Date | null;
  pending_change: PendingChange | null; kb_account_id: string | null; card_last4: string | null;
}

export async function loadSubscription(db: Db, workspaceId: string, lock = false): Promise<SubscriptionRow> {
  const row = await one<SubscriptionRow>(db, `SELECT * FROM subscriptions WHERE workspace_id = $1${lock ? " FOR UPDATE" : ""}`, [workspaceId]);
  if (!row) throw new Error(`workspace ${workspaceId} has no subscription`);
  return row;
}

/** The state by the server's clock: a trial or a grace period has ended at its instant, whoever records it. */
export function effectiveState(row: SubscriptionRow, now: Date): SubscriptionState {
  if (row.state === "trial" && row.trial_ends_at && now >= row.trial_ends_at) return "suspended";
  if (row.state === "past_due" && row.grace_ends_at && now >= row.grace_ends_at) return "suspended";
  return row.state;
}

/** Why a suspended workspace is suspended: the trial ran out, or the grace period after a failed payment did. */
export function suspensionCause(row: SubscriptionRow, now: Date): "trial" | "dunning" | null {
  if (effectiveState(row, now) !== "suspended") return null;
  return row.state === "trial" || row.suspended_by === "trial" ? "trial" : "dunning";
}

function onTrialTerms(row: SubscriptionRow): boolean {
  return row.state === "trial" || row.suspended_by === "trial" || (row.state === "cancelled" && row.kb_account_id === null);
}

export function seatsPurchased(row: SubscriptionRow): number {
  return onTrialTerms(row) ? TRIAL_SEATS : PLANS[row.plan].includedSeats + row.extra_seats;
}

export function tokenLimit(row: SubscriptionRow): number {
  return onTrialTerms(row) ? PLANS.team.tokenLimit : PLANS[row.plan].tokenLimit;
}

export function toSubscription(row: SubscriptionRow, now: Date): Subscription {
  return {
    state: effectiveState(row, now),
    plan: row.plan,
    period: row.period,
    seatsPurchased: seatsPurchased(row),
    extraSeats: row.extra_seats,
    trialEndsAt: row.trial_ends_at ? isoSecond(row.trial_ends_at) : null,
    graceEndsAt: row.grace_ends_at ? isoSecond(row.grace_ends_at) : null,
    pendingChange: row.pending_change,
  };
}

export function isReadOnly(row: SubscriptionRow, now: Date): boolean {
  const state = effectiveState(row, now);
  return state === "suspended" || state === "cancelled";
}

/** The subscription as of now: an edge the scheduler has not reached yet is settled first. */
export async function currentSubscription(workspaceId: string): Promise<SubscriptionRow> {
  const now = new Date();
  const row = await loadSubscription(pool, workspaceId);
  const due = (row.state === "trial" && row.trial_ends_at !== null && now >= row.trial_ends_at)
    || (row.state === "past_due" && ((row.grace_ends_at !== null && now >= row.grace_ends_at)
      || (!row.dunning_day3_sent && row.dunning_day3_at !== null && now >= row.dunning_day3_at)));
  if (!due) return row;
  await settleClock(now, workspaceId);
  return loadSubscription(pool, workspaceId);
}

/** Rejects state-changing scene work while the workspace is suspended or cancelled. */
export async function assertWritable(workspaceId: string): Promise<void> {
  if (isReadOnly(await currentSubscription(workspaceId), new Date())) throw workspaceReadOnly();
}

/** Checkout is legal from a trial, or from a suspension caused by the trial ending. */
export function assertCheckoutAllowed(row: SubscriptionRow, now: Date): void {
  const state = effectiveState(row, now);
  if (state === "trial" || suspensionCause(row, now) === "trial") return;
  throw invalidTransition(state, "active");
}

/** Any state except cancelled may move to cancelled; cancellation is final. */
export function assertCancelAllowed(row: SubscriptionRow): void {
  if (row.state === "cancelled") throw invalidTransition("cancelled", "cancelled");
}

/** Plan and seat changes need an active subscription. */
export function assertActive(row: SubscriptionRow, now: Date): void {
  if (effectiveState(row, now) !== "active") throw conflict("subscription_not_active");
}

/** Team to Business, or monthly to annual on the same plan, is an upgrade; everything else waits for the term end. */
export function changeTiming(from: { plan: Plan; period: Period }, to: { plan: Plan; period: Period }): "immediate" | "end_of_term" {
  if (from.plan === "team" && to.plan === "business") return "immediate";
  if (from.plan === to.plan && from.period === "monthly" && to.period === "annual") return "immediate";
  return "end_of_term";
}

export function assertSeatsFit(seatsUsed: number, seatsAfter: number): void {
  if (seatsAfter < seatsUsed) throw conflict("seats_in_use", { seatsUsed, seatsAfter });
}
