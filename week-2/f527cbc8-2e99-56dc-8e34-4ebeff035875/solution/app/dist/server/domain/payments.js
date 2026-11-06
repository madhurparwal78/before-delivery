// Payment state machine and the refundable amount (brief: Business rules, Payment states).
import { illegalTransition } from "../errors.js";
const EDGES = {
    capture: ["authorized"],
    void: ["authorized"],
    refund: ["captured", "partially_refunded"],
};
/** Refuses an action the payment's status has no edge for, with the illegal-transition 409. */
export function checkPaymentAction(status, action) {
    if (!EDGES[action].includes(status))
        throw illegalTransition(status, action);
}
/** What can still be refunded: captured less refunded less applied. */
export const refundableCents = (payment) => payment.captured_cents - payment.refunded_cents - payment.applied_cents;
/**
 * The status after refunding `amount`: refunded once the whole capture has gone back to the owner, otherwise
 * partially refunded, which includes a deposit whose credit was applied and whose excess was refunded.
 */
export const statusAfterRefund = (payment, amount) => payment.refunded_cents + amount === payment.captured_cents ? "refunded" : "partially_refunded";
