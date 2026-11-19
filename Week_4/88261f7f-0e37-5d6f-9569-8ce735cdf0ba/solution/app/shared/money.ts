import { digitsToInteger } from "./digits";

/** Money is integer cents everywhere; these helpers never touch a float. */

export const CENTS_PER_DOLLAR = 100;
/** What a figure reads when its divisor is zero or nothing has closed yet. */
export const NO_FIGURE = "—";
const THOUSAND_GROUP = /\B(?=(\d{3})+(?!\d))/g;

/** Integer quotient and remainder of a non-negative numerator. */
export function divide(numerator: number, divisor: number): { quotient: number; remainder: number } {
  const remainder = numerator % divisor;
  return { quotient: (numerator - remainder) / divisor, remainder };
}

/** numerator / divisor rounded half up, for non-negative integers. */
export function roundHalfUp(numerator: number, divisor: number): number {
  const { quotient, remainder } = divide(numerator, divisor);
  return remainder * 2 >= divisor ? quotient + 1 : quotient;
}

/** 123456 becomes "$1,234.56"; negative amounts read "-$1,234.56". */
export function formatMoney(cents: number): string {
  const { quotient: dollars, remainder } = divide(Math.abs(cents), CENTS_PER_DOLLAR);
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${String(dollars).replace(THOUSAND_GROUP, ",")}.${String(remainder).padStart(2, "0")}`;
}

/** Largest amount one entry or price may hold: $9,999,999.99, inside the database integer. */
const MAX_CENTS = 999_999_999;

const DOLLAR_AMOUNT = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/** An amount above zero in whole cents. */
export const isAmountCents = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_CENTS;

/** "123.45" becomes 12345; anything else is null. */
export function parseDollars(text: string): number | null {
  const found = DOLLAR_AMOUNT.exec(text.trim().replace(/,/g, ""));
  if (!found) return null;
  const whole = digitsToInteger(found[1] ?? "0");
  const fraction = digitsToInteger((found[2] ?? "").padEnd(2, "0"));
  return whole * CENTS_PER_DOLLAR + fraction;
}

/** 12345 becomes "123.45", the form field text for an amount. */
export function dollarsText(cents: number): string {
  const { quotient, remainder } = divide(Math.abs(cents), CENTS_PER_DOLLAR);
  return `${cents < 0 ? "-" : ""}${quotient}.${String(remainder).padStart(2, "0")}`;
}

const PERCENT_TEXT = /^(\d{1,2})(?:\.(\d{1,2}))?$/;

/** "9.25" becomes 925 hundredths of a percent; null when not a rate from 0 to 30 with at most two decimals. */
export function parsePercentHundredths(text: string): number | null {
  const found = PERCENT_TEXT.exec(text.trim());
  if (!found) return null;
  const hundredths = digitsToInteger(found[1] ?? "0") * 100 + digitsToInteger((found[2] ?? "").padEnd(2, "0"));
  return hundredths <= 3000 ? hundredths : null;
}

/** 925 becomes "9.25". */
export function percentText(hundredths: number): string {
  const { quotient, remainder } = divide(hundredths, 100);
  return `${quotient}.${String(remainder).padStart(2, "0")}`;
}
