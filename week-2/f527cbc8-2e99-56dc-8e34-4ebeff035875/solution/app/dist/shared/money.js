// Money in integer cents end to end; this is the one way an amount prints (brief: Feedback states, `$<amount>`:
// dollars with two decimals and thousands commas). No imports: the server and the browser bundle both load it.
export function dollars(cents) {
    const sign = cents < 0 ? "-" : "";
    const whole = Math.floor(Math.abs(cents) / 100).toLocaleString("en-US");
    return `${sign}$${whole}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}
/** Unsigned dollars with two decimals and no symbol or commas, as the ledger export prints amounts. */
export const plainDollars = (cents) => `${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
