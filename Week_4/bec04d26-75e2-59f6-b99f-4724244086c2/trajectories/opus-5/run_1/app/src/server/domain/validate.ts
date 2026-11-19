const AMOUNT_RE = /^\d{1,12}\.\d{2}$/;
const RATE_RE = /^\d{1,6}\.\d{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_RE.test(value);
}

export function isRate(value: unknown): value is string {
  return typeof value === 'string' && RATE_RE.test(value);
}

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 320 && EMAIL_RE.test(value.trim());
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
