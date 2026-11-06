import { config } from "../config.js";
export const DUNNING_STEPS = [
    { day: 1, kind: "retry", retry: 1 },
    { day: 3, kind: "retry", retry: 2 },
    { day: 7, kind: "retry", retry: 3 },
    { day: 8, kind: "hold" },
    { day: 14, kind: "cancel" },
];
export const HOLD_DAY = 8;
export const CANCEL_DAY = 14;
const STEP_NAMES = { 0: "failed", 1: "retry_1", 3: "retry_2", 7: "retry_3", 8: "shipments_held", 14: "cancelled" };
export function stepInstant(failedAt, day) {
    return new Date(failedAt.getTime() + day * config.dunningDaySeconds * 1000);
}
export function dunningJson(row) {
    const nextRetry = DUNNING_STEPS.find((s) => s.kind === "retry" && s.day > row.step_day);
    return {
        step: STEP_NAMES[row.step_day],
        failed_at: row.failed_at.toISOString(),
        next_retry_at: nextRetry ? stepInstant(row.failed_at, nextRetry.day).toISOString() : null,
        shipments_held: row.shipments_held,
        cancels_at: stepInstant(row.failed_at, CANCEL_DAY).toISOString(),
    };
}
