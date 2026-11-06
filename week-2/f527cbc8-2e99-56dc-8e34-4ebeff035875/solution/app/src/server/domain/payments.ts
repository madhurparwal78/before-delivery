// Payment state machine and the refundable amount (brief: Business rules, Payment states).
import { illegalTransition } from "../errors.js";

export type PaymentStatus = "authorized" | "captured" | "partially_refunded" | "refunded" | "voided" | "declined";
export type PaymentAction = "capture" | "void" | "refund";

const EDGES: Record<PaymentAction, readonly PaymentStatus[]> = {
  capture: ["authorized"],
  void: ["authorized"],
  refund: ["captured", "partially_refunded"],
};

/** Refuses an action the payment's status has no edge for, with the illegal-transition 409. */
export function checkPaymentAction(status: PaymentStatus, action: PaymentAction): void {
  if (!EDGES[action].includes(status)) throw illegalTransition(status, action);
}

interface Amounts {
  captured_cents: number;
  refunded_cents: number;
  applied_cents: number;
}

/** What can still be refunded: captured less refunded less applied. */
export const refundableCents = (payment: Amounts): number =>
  payment.captured_cents - payment.refunded_cents - payment.applied_cents;

/**
 * The status after refunding `amount`: refunded once the whole capture has gone back to the owner, otherwise
 * partially refunded, which includes a deposit whose credit was applied and whose excess was refunded.
 */
export const statusAfterRefund = (payment: Amounts, amount: number): PaymentStatus =>
  payment.refunded_cents + amount === payment.captured_cents ? "refunded" : "partially_refunded";
