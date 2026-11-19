// Money is integer pence everywhere. These helpers only move between pence and text; no arithmetic on pounds.

const POUNDS_INPUT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Pence as plain pounds and pence with comma thousands, no sign: 123405 -> "1,234.05". */
function poundsText(pence: number): string {
  const digits = String(Math.abs(pence)).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${pence < 0 ? "-" : ""}${whole}.${digits.slice(-2)}`;
}

/** The brief's display format: "£1,234.05". */
export function formatPounds(pence: number): string {
  return `£${poundsText(pence)}`;
}

/** Two-decimal pounds without separators, for Kill Bill and form prefill: 1550 -> "15.50". */
export function decimalPounds(pence: number): string {
  return poundsText(pence).replaceAll(",", "");
}

/**
 * Typed pounds -> pence, exactly: digits with optional comma thousands, then an optional point and one or two
 * pence digits. Pound digits and pence digits become integers separately. Anything else is null.
 */
export function parsePounds(text: string): number | null {
  const match = POUNDS_INPUT.exec(text.trim());
  if (!match) return null;
  const pounds = Number.parseInt(match[1].replaceAll(",", ""), 10);
  const pence = Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10);
  const total = pounds * 100 + pence;
  return Number.isSafeInteger(total) ? total : null;
}
