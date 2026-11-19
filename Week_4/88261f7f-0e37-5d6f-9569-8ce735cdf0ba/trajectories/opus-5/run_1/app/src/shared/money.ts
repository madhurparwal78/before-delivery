export type Cents = number;

/** Integer division of `numerator` by `divisor`, rounded half up, away from zero on a tie. */
export function divideRoundHalfUp(numerator: number, divisor: number): number {
  if (divisor <= 0) throw new Error('divisor must be positive');
  const negative = numerator < 0;
  const value = negative ? -numerator : numerator;
  const rounded = Math.floor((value * 2 + divisor) / (divisor * 2));
  return negative ? -rounded : rounded;
}

function groupDigits(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** `$1,234.56`, and `-$1,234.56` for a negative amount. */
export function formatMoney(cents: Cents): string {
  const negative = cents < 0;
  const value = negative ? -cents : cents;
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  const text = `$${groupDigits(String(whole))}.${String(fraction).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** `1234.56` for an amount field, with no grouping and no currency sign. */
export function formatAmountField(cents: Cents): string {
  const negative = cents < 0;
  const value = negative ? -cents : cents;
  const text = `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** Dollars typed by a user, for example `123.45`, as integer cents; null when unusable. */
export function parseAmountToCents(input: string): Cents | null {
  const text = input.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const parts = body.split('.');
  const whole = Number.parseInt(parts[0], 10);
  const fraction = Number.parseInt((parts[1] ?? '').padEnd(2, '0') || '0', 10);
  const cents = whole * 100 + fraction;
  return negative ? -cents : cents;
}
