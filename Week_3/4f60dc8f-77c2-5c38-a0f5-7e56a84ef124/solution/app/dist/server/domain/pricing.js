// Exact money rules: line conversion, VAT on the subtotal, the milestone split and the change-order amount.
import { exponentOf } from "../../shared/money.js";
const RATE_SCALE = 10000n;
const CHANGE_ORDER_NET_PENCE = 18_000;
/** The integer nearest num/den, halves rounded away from zero (num, den > 0 here). */
function roundHalfUp(num, den) {
    return (2n * num + den) / (2n * den);
}
/** A four-decimal rate string ("205.4175") as an exact integer in ten-thousandths. */
function scaledRate(rate) {
    const match = /^(\d+)\.(\d{4})$/.exec(rate);
    if (!match)
        throw new Error(`rate ${rate} is not a four-decimal string`);
    return BigInt(`${match[1]}${match[2]}`);
}
/** round_half_up(pence × rate × 10^exponent / 100), in the account currency's minor units. */
function convertPence(pence, rate, currency) {
    const numerator = BigInt(pence) * scaledRate(rate) * 10n ** BigInt(exponentOf(currency));
    return Number(roundHalfUp(numerator, 100n * RATE_SCALE));
}
/** VAT is 20% of the subtotal, rounded half up once. */
function vatOn(subtotalMinor) {
    return Number(roundHalfUp(BigInt(subtotalMinor) * 20n, 100n));
}
/** Deposit 40% and look-dev 30% rounded down; final delivery takes the remainder. */
function splitTotal(totalMinor) {
    const deposit = Number((BigInt(totalMinor) * 40n) / 100n);
    const lookDev = Number((BigInt(totalMinor) * 30n) / 100n);
    return { deposit_minor: deposit, look_dev_minor: lookDev, final_delivery_minor: totalMinor - deposit - lookDev };
}
export function priceLines(lines, rate, currency) {
    const priced = lines.map((line) => ({ ...line, amount_minor: convertPence(line.unit_price_gbp_minor * line.quantity, rate, currency) }));
    const subtotal = priced.reduce((sum, line) => sum + line.amount_minor, 0);
    const vat = vatOn(subtotal);
    return { lines: priced, subtotal_minor: subtotal, vat_minor: vat, total_minor: subtotal + vat, milestones: splitTotal(subtotal + vat) };
}
/** A change order: net £180.00 converted at the locked rate plus 20% VAT on that converted net. */
export function changeOrderAmount(rate, currency) {
    const net = convertPence(CHANGE_ORDER_NET_PENCE, rate, currency);
    return net + vatOn(net);
}
