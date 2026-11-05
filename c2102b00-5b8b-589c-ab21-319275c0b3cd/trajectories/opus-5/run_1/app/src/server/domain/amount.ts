/** Dollar-text-to-cents conversion: the one place typed dollars become cents. */

const AMOUNT_PATTERN = /^\$?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/;

export const MIN_TOPUP_CENTS = 500;
export const MAX_TOPUP_CENTS = 50_000;

function digitsToNumber(digits: string): number {
  let value = 0;
  for (const digit of digits) value = value * 10 + (digit.codePointAt(0)! - 48);
  return value;
}

export function parseDollarsToCents(raw: string): number | null {
  const match = AMOUNT_PATTERN.exec(raw.trim());
  if (!match) return null;
  const whole = (match[1] ?? '').replace(/,/g, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return digitsToNumber(whole) * 100 + digitsToNumber(fraction);
}

export function topupAmountInRange(cents: number): boolean {
  return cents >= MIN_TOPUP_CENTS && cents <= MAX_TOPUP_CENTS;
}
