/** Money is integer cents everywhere. Typed dollars become cents by exact digit arithmetic. */

export const MAX_AMOUNT_CENTS = Number.MAX_SAFE_INTEGER;

/** The one accepted dollar-entry format: optional $, digits (ungrouped or grouped by commas in threes), up to two decimals. */
const DOLLAR_FORMAT = /^\$?(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/;

type DollarEntry =
  | { ok: true; cents: number }
  | { ok: false; reason: "format" | "zero" };

export function parseDollars(typed: string): DollarEntry {
  const text = typed.trim();
  if (text === "") return { ok: false, reason: "zero" };
  if (!DOLLAR_FORMAT.test(text)) return { ok: false, reason: "format" };
  let whole = 0;
  let fraction = 0;
  let fractionDigits = 0;
  let afterPoint = false;
  for (const char of text) {
    if (char === "$" || char === ",") continue;
    if (char === ".") {
      afterPoint = true;
      continue;
    }
    const digit = char.charCodeAt(0) - 48;
    if (afterPoint) {
      fraction = fraction * 10 + digit;
      fractionDigits += 1;
    } else {
      whole = whole * 10 + digit;
    }
  }
  if (fractionDigits === 1) fraction *= 10;
  if (whole > Math.floor((MAX_AMOUNT_CENTS - 99) / 100)) return { ok: false, reason: "format" };
  const cents = whole * 100 + fraction;
  return cents === 0 ? { ok: false, reason: "zero" } : { ok: true, cents };
}

function groupThousands(digits: string): string {
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return grouped;
}

/** "$1,234.56" from integer cents. */
export function formatDollars(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const fraction = Math.abs(cents) % 100;
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${groupThousands(String(whole))}.${fraction < 10 ? "0" : ""}${fraction}`;
}

/** "$23.90", or "$0" for nothing: the way plan prices read. */
export function formatPlanPrice(cents: number): string {
  return cents === 0 ? "$0" : formatDollars(cents);
}
