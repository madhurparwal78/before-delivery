import type { BookingStatus } from "./api.js";

/** Statuses from which a seat can still be filled or released, a team raised, or the booking cancelled. */
export const isBeforeCheckIn = (status: BookingStatus): boolean =>
  status === "submitted" || status === "open" || status === "partially_covered" || status === "covered";

export const isCancelled = (status: string): boolean => status === "cancelled" || status === "cancelled_late";

/** Completed or cancelled: nothing more can be attached or fetched. */
export const isEnded = (status: string): boolean => status === "completed" || isCancelled(status);

/** A cancellation is charged when it is late and an interpreter holds a seat; otherwise it costs nothing. */
export const isChargedCancellation = (quote: { late: boolean; interpreter_count: number }): boolean => quote.late && quote.interpreter_count > 0;
