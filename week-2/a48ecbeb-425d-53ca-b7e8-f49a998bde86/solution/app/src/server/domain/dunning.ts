import { config } from "../config.js";

// The published dunning schedule: failure on day 0, retries on days 1, 3 and 7, shipments held
// on day 8, cancellation on day 14. A day lasts DUNNING_DAY_SECONDS.

type StepKind = "retry" | "hold" | "cancel";

export const DUNNING_STEPS: { day: number; kind: StepKind; retry?: number }[] = [
  { day: 1, kind: "retry", retry: 1 },
  { day: 3, kind: "retry", retry: 2 },
  { day: 7, kind: "retry", retry: 3 },
  { day: 8, kind: "hold" },
  { day: 14, kind: "cancel" },
];

export const HOLD_DAY = 8;
export const CANCEL_DAY = 14;

const STEP_NAMES: Record<number, string> = { 0: "failed", 1: "retry_1", 3: "retry_2", 7: "retry_3", 8: "shipments_held", 14: "cancelled" };

export function stepInstant(failedAt: Date, day: number): Date {
  return new Date(failedAt.getTime() + day * config.dunningDaySeconds * 1000);
}

export interface DunningRow {
  id: string;
  subscription_id: string;
  invoice_id: string;
  failed_at: Date;
  status: "open" | "recovered" | "cancelled";
  ended_by: "payment" | "schedule" | "customer" | null;
  step_day: number;
  shipments_held: boolean;
  [key: string]: unknown;
}

export function dunningJson(row: DunningRow) {
  const nextRetry = DUNNING_STEPS.find((s) => s.kind === "retry" && s.day > row.step_day);
  return {
    step: STEP_NAMES[row.step_day],
    failed_at: row.failed_at.toISOString(),
    next_retry_at: nextRetry ? stepInstant(row.failed_at, nextRetry.day).toISOString() : null,
    shipments_held: row.shipments_held,
    cancels_at: stepInstant(row.failed_at, CANCEL_DAY).toISOString(),
  };
}
