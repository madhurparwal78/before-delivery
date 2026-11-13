import type { BoxState, PaymentState } from "../shared/domain.js";

/** The single place where box and payment transitions are decided. */

const BOX_MOVES: Record<BoxState, readonly BoxState[]> = {
  available: ["awaiting_transfer", "claimed"],
  awaiting_transfer: ["claimed", "available"],
  claimed: ["packed", "available", "returned"],
  packed: ["shipped", "returned"],
  shipped: ["returned"],
  returned: ["available"],
};

const PAYMENT_MOVES: Record<PaymentState, readonly PaymentState[]> = {
  started: ["challenge", "authorised", "declined", "pending"],
  challenge: ["authorised", "declined"],
  declined: ["started"],
  authorised: ["captured", "voided", "capture_failed", "authorisation_expired"],
  capture_failed: ["captured", "authorisation_expired"],
  captured: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
  voided: [],
  authorisation_expired: [],
  pending: ["settled", "lapsed"],
  settled: ["partially_refunded", "refunded"],
  lapsed: [],
};

export const canMoveBox = (from: BoxState, to: BoxState): boolean => BOX_MOVES[from].includes(to);

export const canMovePayment = (from: PaymentState, to: PaymentState): boolean => PAYMENT_MOVES[from].includes(to);

/** States in which an order still has the money of a captured or settled sale at stake. */
const isPaidState = (state: PaymentState): boolean =>
  state === "captured" || state === "settled" || state === "partially_refunded";

/** A refund may be asked of any order that was charged, even one already fully refunded (the remainder check answers). */
export const isRefundableState = (state: PaymentState): boolean => isPaidState(state) || state === "refunded";

/** An attempt still waiting on the bank: started, or at its 3-D Secure check. */
export const awaitsAuthorisation = (state: PaymentState): boolean => state === "started" || state === "challenge";

/** Authorised but not captured: the card can still be captured, or the authorisation ends. */
export const holdsAuthorisation = (state: PaymentState): boolean => state === "authorised" || state === "capture_failed";

/** Attempts a collector may start again from: a bank check left open, or a decline. */
export const canRetryAttempt = (state: PaymentState): boolean => state === "challenge" || state === "declined";
