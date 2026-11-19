const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function readString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' ? value : null;
}

export function readInteger(body: Record<string, unknown>, field: string): number | null {
  const value = body[field];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function readArray(body: Record<string, unknown>, field: string): unknown[] | null {
  const value = body[field];
  return Array.isArray(value) ? value : null;
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function inRange(value: number, low: number, high: number): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}
