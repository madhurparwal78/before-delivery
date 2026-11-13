/** The rate with the latest effective_from on or before the assignment date. */
export function selectRate(contract, assignmentDate) {
    const sorted = [...contract.rates].sort((a, b) => (a.effective_from < b.effective_from ? -1 : a.effective_from > b.effective_from ? 1 : 0));
    let chosen = sorted[0];
    for (const rate of sorted) {
        if (rate.effective_from <= assignmentDate)
            chosen = rate;
        else
            break;
    }
    return chosen;
}
/** Billable minutes: the basis rounded up to the increment, or the minimum if larger. */
export function billableMinutes(contract, basisMinutes) {
    const inc = contract.increment_minutes;
    const rounded = Math.ceil(basisMinutes / inc) * inc;
    return Math.max(rounded, contract.minimum_minutes);
}
/** Round a non-negative rational to whole cents with exact halves rounding up. */
function roundHalfUpCents(numerator, denominator) {
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    if (remainder * 2n < denominator)
        return Number(quotient);
    return Number(quotient + 1n);
}
/** Time amount = hourly × billable × count ÷ 60, then × (10000 + surcharge bp) ÷ 10000 when the
 * surcharge applies (interpreter count 2). One rounding step, exact halves up. */
export function computeLineAmounts(contract, rate, basisMinutes, interpreterCount, mileageMiles) {
    const billable = billableMinutes(contract, basisMinutes);
    const count = interpreterCount === 2 ? 2 : 1;
    const numerator = BigInt(rate.hourly_rate_cents) * BigInt(billable) * BigInt(count);
    let timeNumerator = numerator * 10000n;
    const denominator = 60n * 10000n;
    if (count === 2) {
        timeNumerator = timeNumerator * BigInt(10000 + rate.team_surcharge_bp) / 10000n;
    }
    const timeAmount = roundHalfUpCents(timeNumerator, denominator);
    const mileageAmount = Math.round(mileageMiles * rate.mileage_cents_per_mile);
    return {
        billableMinutes: billable,
        timeAmountCents: timeAmount,
        mileageAmountCents: mileageAmount,
        amountCents: timeAmount + mileageAmount,
    };
}
/** Money as `$` with thousands commas and two decimals. */
export function formatCents(cents) {
    const negative = cents < 0;
    const abs = Math.abs(cents);
    const dollars = Math.floor(abs / 100);
    const frac = abs % 100;
    const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}$${grouped}.${frac.toString().padStart(2, '0')}`;
}
