import { codePoints } from './text.js';

// Amounts in requests: plain-digit JSON numbers from 1 to 2^53-1.
export function readAmountCents(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  if (value < 1 || value > 9007199254740991) return null;
  return value;
}

export function formatDollars(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString();
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}$${groupThousands(whole)}.${frac}`;
}

export function groupThousands(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

export function formatPlainSigned(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// Rounding half up on a rational numerator/denominator, never via floats.
export function roundHalfUp(numerator, denominator) {
  // denominator > 0; result is the integer nearest numerator/denominator,
  // with exact halves going up (towards positive infinity).
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  if (2 * r >= denominator) return q + 1;
  return q;
}
