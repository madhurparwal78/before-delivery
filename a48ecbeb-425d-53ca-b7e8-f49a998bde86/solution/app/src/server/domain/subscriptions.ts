import { config } from "../config.js";
import { query } from "../db.js";
import { ApiError, validation } from "../http.js";
import {
  accountBalanceCents,
  blockingStates,
  killBillNow,
  planByName,
  subscription as kbSubscription,
  type BlockingStateJson,
  type SubscriptionJson,
} from "../killbill.js";
import { torontoDay } from "../../shared/format.js";
import { dunningJson, type DunningRow } from "./dunning.js";
import type { ShipTo } from "./orders.js";

// A subscription's state is derived only from Kill Bill's records (plus the dunning schedule the
// server runs against Kill Bill's unpaid invoice). This file decides the change cutoff, each
// change's legality and its effective date.

export type ChangeKind = "pause" | "resume" | "skip" | "swap" | "cancel";

export interface SubscriptionRow {
  id: string;
  user_id: string;
  email: string;
  customer_name: string;
  account_id: string;
  province: string;
  ship_to: ShipTo;
  card_brand: string;
  card_last4: string;
  card_exp_month: number;
  card_exp_year: number;
  card_behaviour: "approve" | "decline" | "first_only";
  payment_method_id: string;
  first_invoice_id: string;
  [key: string]: unknown;
}

export interface ChangeRow {
  id: string;
  subscription_id: string;
  kind: ChangeKind;
  cycles: number | null;
  plan: string | null;
  status: "pending_provider" | "applied" | "rejected";
  effective_date: string;
  requested_at: Date;
  written: boolean;
  [key: string]: unknown;
}

export function changeJson(c: ChangeRow) {
  return {
    id: c.id,
    kind: c.kind,
    status: c.status,
    effective_date: c.effective_date,
    requested_at: c.requested_at.toISOString(),
  };
}

// ---- calendar -----------------------------------------------------------------------------

/** Adds calendar months, clamping to the month's last day. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const index = m - 1 + months;
  const year = y + Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export const cycleMonths = (plan: string): number => (planByName(plan)?.cadence === "bimonthly" ? 2 : 1);

/** Midnight at the start of `day` in America/Toronto, as an instant. */
function torontoMidnight(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    hourCycle: "h23",
    day: "2-digit",
  }).formatToParts(new Date(utcMidnight + 12 * 3600_000));
  const hour = Number(local.find((p) => p.type === "hour")?.value);
  const offsetHours = hour - 12;
  return new Date(utcMidnight - offsetHours * 3600_000);
}

/** The change cutoff for a renewal date: Toronto midnight of that date minus CHANGE_CUTOFF_HOURS. */
export function changeCutoff(renewalDate: string): Date {
  return new Date(torontoMidnight(renewalDate).getTime() - config.changeCutoffHours * 3600_000);
}

/** The date the next pause, skip or swap would start, judged by Kill Bill's clock. */
function changesApplyTo(renewalDate: string, plan: string, kbNow: Date): string {
  return kbNow < changeCutoff(renewalDate) ? renewalDate : addMonths(renewalDate, cycleMonths(plan));
}

// ---- state derivation ---------------------------------------------------------------------

export type State = "active" | "paused" | "past_due" | "cancel_pending" | "cancelled";

interface Mark {
  at: Date;
  day: string;
  state: string;
}

/** The ceibo-service blocking timeline for one subscription; a later entry on the same instant wins. */
function timeline(blocks: BlockingStateJson[], subscriptionId: string): Mark[] {
  const marks: Mark[] = [];
  for (const b of blocks) {
    if (b.blockedId !== subscriptionId || b.service !== "ceibo") continue;
    const at = new Date(b.effectiveDate);
    const last = marks[marks.length - 1];
    if (last && last.at.getTime() === at.getTime()) marks.pop();
    marks.push({ at, day: b.effectiveDate.slice(0, 10), state: b.stateName });
  }
  return marks;
}

export interface Derived {
  kb: SubscriptionJson;
  kbNow: Date;
  state: State;
  plan: string;
  pause: { from: string; resumes_on: string } | null;
  skip: { date: string } | null;
  nextRenewalDate: string;
  billingEndDate: string | null;
  changeCutoff: Date;
  changesApplyTo: string;
  dunning: DunningRow | null;
  /** The latest dunning run, kept so a subscription dunning cancelled can say why it ended. */
  latestDunning: DunningRow | null;
  cancelledByDunning: boolean;
}

export async function derive(row: SubscriptionRow): Promise<Derived> {
  const [kb, blocks, kbNow, dunningRows] = await Promise.all([
    kbSubscription(row.id),
    blockingStates(row.account_id, "SUBSCRIPTION"),
    killBillNow(),
    query<DunningRow>("SELECT * FROM dunning WHERE subscription_id = $1 ORDER BY failed_at DESC LIMIT 1", [row.id]),
  ]);
  const marks = timeline(blocks, row.id);
  const current = [...marks].reverse().find((m) => m.at <= kbNow);
  const future = marks.filter((m) => m.at > kbNow);
  const resumeAfter = (from: Mark) => marks.find((m) => m.at > from.at && m.state === "CEIBO_ACTIVE")?.day ?? null;

  let pause: Derived["pause"] = null;
  const pausedNow = current?.state === "CEIBO_PAUSED";
  const pauseMark = pausedNow ? current : future.find((m) => m.state === "CEIBO_PAUSED");
  if (pauseMark) {
    const resumes = resumeAfter(pauseMark);
    if (resumes) pause = { from: pauseMark.day, resumes_on: resumes };
  }
  const skipMark = future.find((m) => m.state === "CEIBO_SKIPPED");
  const skip = skipMark ? { date: skipMark.day } : null;

  const nextRenewalDate = (kb.chargedThroughDate ?? torontoDay(kbNow)).slice(0, 10);
  const billingEndDate = kb.billingEndDate ? kb.billingEndDate.slice(0, 10) : null;
  const latest = dunningRows[0] ?? null;
  const openDunning = latest?.status === "open" ? latest : null;

  let state: State = "active";
  if (kb.state === "CANCELLED" || kb.state === "EXPIRED") state = "cancelled";
  else if (billingEndDate) state = "cancel_pending";
  else if (openDunning && (await accountBalanceCents(row.account_id)) > 0) state = "past_due";
  else if (pausedNow) state = "paused";

  return {
    kb,
    kbNow,
    state,
    plan: kb.planName,
    pause,
    skip,
    nextRenewalDate,
    billingEndDate,
    changeCutoff: changeCutoff(nextRenewalDate),
    changesApplyTo: changesApplyTo(nextRenewalDate, kb.planName, kbNow),
    dunning: state === "past_due" ? openDunning : null,
    latestDunning: latest,
    // Kill Bill is cancelled first and the schedule row closed right after, so either order counts.
    cancelledByDunning: state === "cancelled" && latest !== null && (latest.status === "open" || latest.ended_by === "schedule"),
  };
}

export async function subscriptionJson(row: SubscriptionRow, d: Derived) {
  const latestDunning = d.latestDunning;
  const [pending] = await query<ChangeRow>(
    "SELECT * FROM change_requests WHERE subscription_id = $1 AND status = 'pending_provider'",
    [row.id],
  );
  const [last] = await query<ChangeRow>(
    "SELECT * FROM change_requests WHERE subscription_id = $1 ORDER BY requested_at DESC LIMIT 1",
    [row.id],
  );
  const plan = planByName(d.plan);
  return {
    id: row.id,
    plan: d.plan,
    plan_label: plan?.label ?? d.plan,
    cadence: plan?.cadence ?? "monthly",
    state: d.state,
    next_renewal_date: d.nextRenewalDate,
    billing_end_date: d.billingEndDate,
    pause: d.pause,
    skip: d.skip,
    change_cutoff: d.changeCutoff.toISOString(),
    changes_apply_to: d.changesApplyTo,
    pending_change: pending ? changeJson(pending) : null,
    last_change: last ? changeJson(last) : null,
    dunning: d.dunning ? dunningJson(d.dunning) : d.cancelledByDunning && latestDunning ? { ...dunningJson(latestDunning), step: "cancelled", next_retry_at: null } : null,
    card: { brand: row.card_brand, last4: row.card_last4 },
  };
}


// ---- change legality and effective dates --------------------------------------------------

const illegal = (): ApiError => new ApiError(409, "illegal_change", "That change isn't possible right now.");

export interface ChangeRequest {
  kind: ChangeKind;
  cycles?: number;
  plan?: string;
}

/**
 * Decides whether a change may be requested now, in the brief's order: a pending change first,
 * then the state rules, then field validation.
 */
export function checkChange(request: ChangeRequest, d: Derived, hasPending: boolean): void {
  if (hasPending) throw new ApiError(409, "change_pending", "A change is already waiting for confirmation.");
  if (d.state === "cancel_pending" || d.state === "cancelled") throw illegal();
  if (d.state === "past_due" && request.kind !== "cancel") throw illegal();
  const paused = d.state === "paused";
  switch (request.kind) {
    case "pause":
      if (paused || d.pause) throw illegal();
      if (request.cycles === undefined || request.cycles < 1 || request.cycles > 3) {
        throw validation({ cycles: "Pause for 1, 2 or 3 boxes." });
      }
      return;
    case "resume":
      if (!d.pause) throw illegal();
      return;
    case "skip":
      if (paused || d.pause || d.skip) throw illegal();
      return;
    case "swap": {
      if (request.plan === d.plan) throw illegal();
      const target = request.plan === undefined ? undefined : planByName(request.plan);
      const current = planByName(d.plan);
      if (!target) throw validation({ plan: "Pick one of the listed boxes." });
      if (target.cadence !== current?.cadence) throw validation({ plan: "Pick a box with the same delivery rhythm." });
      return;
    }
    case "cancel":
      return;
  }
}

/** The date a change takes effect. */
export function effectiveDate(request: ChangeRequest, d: Derived): string {
  switch (request.kind) {
    case "pause":
    case "skip":
    case "swap":
      return d.changesApplyTo;
    case "resume":
      return torontoDay(d.kbNow);
    case "cancel":
      return d.nextRenewalDate;
  }
}

export async function subscriptionRow(id: string, userId?: string): Promise<SubscriptionRow | undefined> {
  const [row] = await query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE id = $1 ${userId === undefined ? "" : "AND user_id = $2"}`,
    userId === undefined ? [id] : [id, userId],
  );
  return row;
}
