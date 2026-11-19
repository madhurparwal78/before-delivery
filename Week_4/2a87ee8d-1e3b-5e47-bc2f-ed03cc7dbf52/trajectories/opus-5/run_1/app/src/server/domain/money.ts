/**
 * Money is handled as exact decimal strings or integer cents, never as floating point.
 * Kill Bill's JSON carries amounts as numbers, converted at that boundary only.
 */

const FEE_PATTERN = /^(\d{1,6})(?:\.(\d{1,2}))?$/;
const MAX_FEE_CENTS = 100_000 * 100;

export function parseFee(value: string): string | null {
  const match = FEE_PATTERN.exec(value);
  if (!match) return null;
  const cents = Number.parseInt(match[1] as string, 10) * 100 + Number.parseInt((match[2] ?? '0').padEnd(2, '0'), 10);
  if (cents > MAX_FEE_CENTS) return null;
  return centsToDecimal(cents);
}

export function decimalToCents(value: string): number {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = Number.parseInt(whole as string, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0').slice(0, 2) || '0', 10);
  return negative ? -cents : cents;
}

function centsToDecimal(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const text = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** Kill Bill reports amounts as JSON numbers; convert at the boundary with half-up rounding to the cent. */
export function killbillAmountToDecimal(amount: number): string {
  const cents = Math.sign(amount) * Math.round(Math.abs(amount) * 100 + Number.EPSILON);
  return centsToDecimal(cents);
}

export function decimalToKillbillAmount(value: string): number {
  return decimalToCents(value) / 100;
}

/** United Kingdom formatting with a thousands comma and two decimals, for example 1,250.10. */
export function formatAmountForDisplay(value: string): string {
  const cents = decimalToCents(value);
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${whole}.${String(absolute % 100).padStart(2, '0')}`;
}

export function isZeroAmount(value: string): boolean {
  return decimalToCents(value) === 0;
}
