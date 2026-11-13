import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Decimalish = Decimal.Value;

export function dec(value: Decimalish): Decimal {
  return new Decimal(value);
}

/** Round half up to the given number of decimal places, returning a Decimal. */
export function roundHalfUp(value: Decimalish, places: number): Decimal {
  return new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

/** Format an integer-cent amount as $1,274.92 with thousands separators. */
export function formatMoney(amountCents: number): string {
  const negative = amountCents < 0;
  const abs = Math.abs(amountCents);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const groups = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${groups}.${cents.toString().padStart(2, "0")}`;
}

/** Multiply cents by an exact percentage, rounding half up to the cent. */
export function centsTimesPercent(amountCents: number, percent: string): number {
  const raw = dec(amountCents).times(dec(percent)).dividedBy(dec(100));
  const rounded = raw.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return rounded.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Convert to an exact integer cent value from a decimal string like "749.95". */
export function centsFromDecimalString(value: string): number {
  return dec(value).times(dec(100)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Format a result value with its marker's decimals ("22.5"). */
export function formatResultValue(value: string, decimals: number): string {
  return roundHalfUp(value, decimals).toFixed(decimals);
}
