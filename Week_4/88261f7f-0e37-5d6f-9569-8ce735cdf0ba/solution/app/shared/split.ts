import { CENTS_PER_DOLLAR, divide } from "./money";

const MIN_SHARES = 2;
export const MAX_SHARES = 4;
const WHOLE_PERCENT_TOTAL = 100;

/** Two to four whole percentages above zero that add up to 100. */
export function validPercents(percents: readonly unknown[]): percents is number[] {
  return (
    percents.length >= MIN_SHARES &&
    percents.length <= MAX_SHARES &&
    percents.every((percent) => typeof percent === "number" && Number.isInteger(percent) && percent > 0) &&
    (percents as number[]).reduce((sum, percent) => sum + percent, 0) === WHOLE_PERCENT_TOTAL
  );
}

/** Each share rounded down, then the remaining cents one at a time from the first folio. */
export function splitShares(cents: number, percents: readonly number[]): number[] {
  const shares = percents.map((percent) => divide(cents * percent, CENTS_PER_DOLLAR).quotient);
  let remainder = cents - shares.reduce((sum, share) => sum + share, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % shares.length, remainder -= 1) {
    shares[index] = (shares[index] ?? 0) + 1;
  }
  return shares;
}
