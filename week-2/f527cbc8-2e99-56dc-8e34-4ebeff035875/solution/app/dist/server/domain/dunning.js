// Dunning: the retry schedule and the state each decline or payment leads to (brief: Business rules, Dunning).
/** SQL: the owner holds an invoice in the blocked dunning state, which stops holds, joins and offers. */
export const ownerBlockedSql = (ownerColumn) => `EXISTS (SELECT 1 FROM invoices i WHERE i.owner_id = ${ownerColumn} AND i.dunning_state = 'blocked')`;
/** Retry instants: first_declined_at plus N × day seconds for each N in the retry days. */
export const retrySchedule = (firstDeclinedAt, retryDays, daySeconds) => retryDays.map((days) => firstDeclinedAt + days * daySeconds * 1000);
const SOFT_STEPS = {
    past_due: "retry_1",
    retry_1: "retry_2",
    retry_2: "blocked",
};
/** The state after a manual decline: the first soft decline enters past_due; later ones change nothing unless hard. */
export function afterManualDecline(state, hard) {
    if (hard)
        return "blocked";
    return state === "none" || state === "cleared" ? "past_due" : state;
}
/** The state after a scheduled retry declines: one soft step, or straight to blocked when hard. */
export function afterRetryDecline(state, hard) {
    if (hard)
        return "blocked";
    return SOFT_STEPS[state] ?? state;
}
/** Any successful payment clears an invoice that was in dunning. */
export const afterPayment = (state) => (state === "none" ? "none" : "cleared");
export const inDunning = (state) => state === "past_due" || state === "retry_1" || state === "retry_2";
