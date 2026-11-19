import { type Rational, rational, roundDown, roundHalfUp, times, whole } from "./decimal.ts";

export type Currency = "EUR" | "GBP" | "USD" | "JPY" | "AED";
export type PriceKey = "eur" | "gbp" | "usd" | "jpy" | "aed";

export const PRICE_KEYS: readonly PriceKey[] = ["eur", "gbp", "usd", "jpy", "aed"];

const DECIMALS: Record<Currency, number> = { EUR: 2, GBP: 2, USD: 2, JPY: 0, AED: 2 };
const PREFIX: Record<Currency, string> = { EUR: "€", GBP: "£", USD: "US$", JPY: "¥", AED: "AED " };

export function currencyDecimals(currency: Currency): number {
  return DECIMALS[currency];
}

export function priceKey(currency: Currency): PriceKey {
  return currency.toLowerCase() as PriceKey;
}

/** An exact major-unit amount rounded once, half up, to the smallest unit. */
export function toMinor(amount: Rational, currency: Currency): bigint {
  return roundHalfUp(times(amount, whole(10n ** BigInt(DECIMALS[currency]))));
}

export function minorOfPrice(price: string, currency: Currency): bigint {
  return toMinor(rational(price), currency);
}

export function printAmount(minor: bigint, currency: Currency): string {
  const digits = DECIMALS[currency];
  const text = minor.toString().padStart(digits + 1, "0");
  const units = digits === 0 ? text : text.slice(0, -digits);
  const cents = digits === 0 ? "" : `.${text.slice(-digits)}`;
  return `${PREFIX[currency]}${units.replace(/\B(?=(\d{3})+$)/g, ",")}${cents}`;
}

const MILESTONE_PERCENTS = [30, 40, 30] as const;

/** 30%, 40% and 30% rounded down, with any left-over units going one each to the earlier milestones. */
export function splitMilestones(totalMinor: bigint): { percent: number; amountMinor: bigint }[] {
  const parts = MILESTONE_PERCENTS.map((percent) => ({
    percent,
    amountMinor: roundDown({ num: totalMinor * BigInt(percent), den: 100n }),
  }));
  let left = totalMinor - parts.reduce((sum, part) => sum + part.amountMinor, 0n);
  for (const part of parts) {
    if (left === 0n) break;
    part.amountMinor += 1n;
    left -= 1n;
  }
  return parts;
}
