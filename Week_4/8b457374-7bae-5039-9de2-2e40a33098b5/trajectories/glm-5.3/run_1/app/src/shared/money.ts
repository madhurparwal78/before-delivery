import type { Zone } from "./domain.js";
import { ZONE_NAMES } from "./domain.js";

// All money in the product is integer pence. Formatting, parsing, and the fee
// and pledge-amount rules live here and nowhere else.

export function formatPence(pence: number): string {
  const negative = pence < 0;
  const abs = Math.abs(Math.trunc(pence));
  const pounds = Math.floor(abs / 100);
  const rest = abs % 100;
  const poundsText = pounds.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? "-£" : "£";
  return `${sign}${poundsText}.${rest.toString().padStart(2, "0")}`;
}

/**
 * Parses pounds typed into a field: digits with optional comma thousand
 * separators, optionally followed by a point and one or two pence digits,
 * never a £ sign. Returns pence, or null when the format is wrong.
 */
export function parsePoundsField(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cleaned = t.replace(/,/g, "");
  const [whole, fraction = ""] = cleaned.split(".");
  if (!/^\d+$/.test(whole)) return null;
  if (fraction !== "" && !/^\d{1,2}$/.test(fraction)) return null;
  const wholePence = Number(whole) * 100;
  const fractionPence = fraction === "" ? 0 : Number(fraction.padEnd(2, "0"));
  return wholePence + fractionPence;
}

export interface FeeParts {
  platform_fee: number;
  processing_fee: number;
  to_creator: number;
}

/** Integer half-up rounding of numerator/denominator, exact for safe-integer inputs. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

/** The single implementation of the fee rule, in whole pence, half-up. */
export function feesForAmount(amount: number): FeeParts {
  const platform_fee = divRoundHalfUp(amount * 5, 100);
  const processing_fee = divRoundHalfUp(amount * 3, 100) + 20;
  return { platform_fee, processing_fee, to_creator: amount - platform_fee - processing_fee };
}

export interface PledgeQuoteParts {
  reward: number;
  shipping: number;
  add_on: number;
}

/** The single implementation of the pledge amount rule: price + zone shipping + add-on. */
export function pledgeAmount(parts: PledgeQuoteParts): number {
  return parts.reward + parts.shipping + parts.add_on;
}

export function zoneName(zone: Zone): string {
  return ZONE_NAMES[zone];
}
