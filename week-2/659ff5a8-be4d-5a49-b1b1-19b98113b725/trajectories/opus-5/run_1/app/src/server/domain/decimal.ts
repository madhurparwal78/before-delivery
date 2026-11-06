/** Fixed-point helpers. Times are integer thousandths; factors integer ten-thousandths. */

const TIME_PATTERN = /^\d{2,3}\.\d{3}$/;
const FACTOR_PATTERN = /^\d\.\d{4}$/;

export const MIN_RAW_TIME_MS = 10_000;
export const MAX_RAW_TIME_MS = 999_999;
export const MIN_FACTOR_TT = 4_000;
export const MAX_FACTOR_TT = 12_000;

export function isRawTimeText(text: string): boolean {
  return TIME_PATTERN.test(text);
}

export function parseRawTime(text: string): number | null {
  if (!isRawTimeText(text)) return null;
  const [whole, fraction] = text.split('.') as [string, string];
  const ms = Number.parseInt(whole, 10) * 1000 + Number.parseInt(fraction, 10);
  if (ms < MIN_RAW_TIME_MS || ms > MAX_RAW_TIME_MS) return null;
  return ms;
}

export function parseFactor(text: string): number | null {
  if (!FACTOR_PATTERN.test(text)) return null;
  const [whole, fraction] = text.split('.') as [string, string];
  const tt = Number.parseInt(whole, 10) * 10_000 + Number.parseInt(fraction, 10);
  if (tt < MIN_FACTOR_TT || tt > MAX_FACTOR_TT) return null;
  return tt;
}

export function formatTime(ms: number | null): string | null {
  if (ms === null) return null;
  const whole = Math.trunc(ms / 1000);
  const fraction = ms % 1000;
  return `${whole}.${String(fraction).padStart(3, '0')}`;
}

export function formatFactor(tt: number | null): string | null {
  if (tt === null) return null;
  const whole = Math.trunc(tt / 10_000);
  const fraction = tt % 10_000;
  return `${whole}.${String(fraction).padStart(4, '0')}`;
}

/** Exact division of non-negative integers, rounded half up. */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}
