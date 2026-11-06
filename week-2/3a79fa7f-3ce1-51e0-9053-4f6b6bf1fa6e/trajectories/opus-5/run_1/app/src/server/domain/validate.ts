/** Field validation shared by every endpoint, including the header-safe field rules. */

const CONTROL_OR_SEPARATOR = /[\u0000-\u001F\u007F\u2028\u2029]/;
const EMAIL_SHAPE = /^[^@]+@[^@.]+(\.[^@.]+)+$/;
const EMAIL_FORBIDDEN = /[,;<>\s]/;
const PHONE_SHAPE = /^\+[1-9][0-9]{7,14}$/;

export const PHONE_MESSAGE = 'Enter your number in international format, like +14155550100.';
export const EMAIL_MESSAGE = 'Enter a valid email.';

export function isHeaderSafe(value: string): boolean {
  return !CONTROL_OR_SEPARATOR.test(value);
}

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (EMAIL_FORBIDDEN.test(trimmed) || !isHeaderSafe(trimmed)) return false;
  return EMAIL_SHAPE.test(trimmed);
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidPhone(value: unknown): value is string {
  return typeof value === 'string' && PHONE_SHAPE.test(value);
}

/** A header-safe text field of a bounded length. */
export function isSafeText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && isHeaderSafe(value) && value.length >= min && value.length <= max;
}

export function isBoundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

/** CRLF and a lone CR are both stored as LF. */
export function normaliseMessage(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function isJsonInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 2; i >= 0; i -= 1) {
    const digit = Number(digits[i]);
    const value = double ? digit * 2 : digit;
    sum += value > 9 ? value - 9 : value;
    double = !double;
  }
  return (sum + Number(digits[digits.length - 1])) % 10 === 0;
}

/** TF followed by nine digits, the last being the Luhn check digit of the first eight. */
export function isValidSerial(value: unknown): value is string {
  if (typeof value !== 'string' || !/^TF[0-9]{9}$/.test(value)) return false;
  return luhnValid(value.slice(2));
}
