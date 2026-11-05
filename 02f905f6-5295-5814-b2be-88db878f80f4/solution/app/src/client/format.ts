// Display formatting: money from integer cents, sizes with units, piece numbers.
import { dollars } from "../shared/money";
import { gridHalves } from "../shared/rules";

/** "$4.41"; a negative amount (account credit) reads "-$4.41". */
export function money(cents: number): string {
  const text = dollars(cents);
  return text.startsWith("-") ? `-$${text.slice(1)}` : `$${text}`;
}

/** "3.00" or "60" typed dollars into cents, or null when it is not an amount. */
export function centsFromDollars(text: string): number | null {
  const match = /^\s*\$?(\d+)(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

const inches = (value: string) => `${value} in`;

/** Half-inches as the short coordinate a person types: 19 -> "9.5", 20 -> "10". */
export function halvesText(halves: number): string {
  return halves % 2 === 0 ? String(halves / 2) : `${(halves - 1) / 2}.5`;
}

/** "4.0" -> 8 half-inches (API sizes and coordinates are always on the half-inch grid). */
export const halvesOf = (value: string) => gridHalves(value) ?? 0;

/** Converts a typed size between units, to two decimals: inches × 2.54, or cm ÷ 2.54. */
export function convertSize(text: string, to: "in" | "cm"): string {
  const match = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return text;
  const hundredths = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  const scaled = to === "cm" ? Math.floor((hundredths * 254 + 50) / 100) : Math.floor((hundredths * 100 + 127) / 254);
  return `${Math.floor(scaled / 100)}.${String(scaled % 100).padStart(2, "0")}`;
}

export const PLAN_LABELS = {
  bisque_and_glaze: "Bisque and glaze",
  bisque_only: "Bisque only",
  glaze_only: "Glaze only",
} as const;
