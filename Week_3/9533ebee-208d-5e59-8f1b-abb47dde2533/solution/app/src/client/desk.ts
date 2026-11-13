// Typed input in the desk formats: what the interface accepts in an amount, price, percentage or desk-time field.
// Each parser returns the value in the API's own format or the published browser-side message.

import { NNBSP, parseDeskTime } from "../shared/format.ts";

const MESSAGE = {
  format: "Enter digits with a comma before the decimals.",
  zero: "Enter an amount above zero.",
  percent: "Enter a percentage with at most two decimals, for example 80,00.",
  deskTime: "Enter a desk time like 2026-11-01 01:30.",
  gap: "That time doesn’t exist in the desk time zone – the clocks skip it.",
} as const;

const precision = (decimals: number) => `Enter at most ${decimals} digits after the comma.`;

type Typed<T> = { ok: true; value: T } | { ok: false; error: string };

// Digits with optional U+202F grouping placed exactly as the display places it, an optional comma and fraction,
// no sign, and no leading zero except a single 0 before the comma.
const NUMBER = new RegExp(`^(0|[1-9]\\d*|[1-9]\\d{0,2}(?:${NNBSP}\\d{3})+)(?:,(\\d+))?$`);

/** A typed number as its digits and fraction digits, or the browser-side message. */
function digits(typed: string, decimals: number): Typed<{ whole: string; fraction: string }> {
  const match = NUMBER.exec(typed);
  if (!match) return { ok: false, error: MESSAGE.format };
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return { ok: false, error: precision(decimals) };
  const whole = (match[1] ?? "").replaceAll(NNBSP, "");
  if (/^0*$/.test(`${whole}${fraction}`)) return { ok: false, error: MESSAGE.zero };
  return { ok: true, value: { whole, fraction } };
}

/** A typed amount as minor units of the asset. */
export function parseAmount(typed: string, decimals: number): Typed<string> {
  const parsed = digits(typed, decimals);
  if (!parsed.ok) return parsed;
  const minor = `${parsed.value.whole}${parsed.value.fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  return { ok: true, value: minor };
}

/** A typed price, with or without `$`, as the API sends it: digits, a point and exactly the decimals typed. */
export function parsePrice(typed: string): Typed<string> {
  const parsed = digits(typed.startsWith("$") ? typed.slice(1) : typed, 8);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value.fraction === "" ? parsed.value.whole : `${parsed.value.whole}.${parsed.value.fraction}` };
}

/** A typed percentage without `%` as basis points: up to two decimals, e.g. `80,00` → 8000. */
export function parsePercent(typed: string): Typed<number> {
  const match = /^(\d{1,3})(?:,(\d{1,2}))?$/.exec(typed.trim());
  if (!match) return { ok: false, error: MESSAGE.percent };
  return { ok: true, value: Number.parseInt(`${match[1]}${(match[2] ?? "").padEnd(2, "0")}`, 10) };
}

/** A typed `YYYY-MM-DD HH:MM` desk wall time as a canonical UTC instant. */
export function parseDesk(typed: string, zone: string): Typed<string> {
  const parsed = parseDeskTime(typed, zone);
  return parsed.ok ? { ok: true, value: parsed.iso } : { ok: false, error: parsed.reason === "gap" ? MESSAGE.gap : MESSAGE.deskTime };
}

/** The error of a field that is being typed in; an empty field has none until it is submitted. */
export function liveError(typed: string, check: (typed: string) => Typed<unknown>): string | undefined {
  if (typed === "") return undefined;
  const result = check(typed);
  return result.ok ? undefined : result.error;
}
