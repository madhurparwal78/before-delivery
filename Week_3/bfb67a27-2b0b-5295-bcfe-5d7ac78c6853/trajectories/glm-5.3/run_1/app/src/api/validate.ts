// Validation messages for shared fields (published copy).

export const MESSAGES = {
  pickupDate: 'Pick a pickup date from today on',
  returnDate: 'Return between 1 and 14 days after pickup',
  renterName: 'Enter your name',
  renterEmail: 'Enter a valid email',
  units: 'Pick a unit that belongs to this kit',
  money: 'Enter a whole number of cents above zero',
  idempotencyKey: 'Send an Idempotency-Key header',
} as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

export function validateDates(
  pickup: unknown,
  ret: unknown,
  today: string,
): { pickupDate: string; returnDate: string } | { error: 'pickupDate' | 'returnDate' } {
  if (!isDateString(pickup)) {
    return { error: 'pickupDate' };
  }
  if (!isDateString(ret)) {
    return { error: 'returnDate' };
  }
  if (pickup < today) {
    return { error: 'pickupDate' };
  }
  const days = Math.round(
    (new Date(`${ret}T00:00:00.000Z`).getTime() - new Date(`${pickup}T00:00:00.000Z`).getTime()) / 86400000,
  );
  if (days < 1 || days > 14) {
    return { error: 'returnDate' };
  }
  return { pickupDate: pickup, returnDate: ret };
}

export function validName(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80;
}

export function validEmail(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 254) {
    return false;
  }
  const at = value.indexOf('@');
  if (at <= 0 || value.indexOf('@', at + 1) !== -1) {
    return false;
  }
  const domain = value.slice(at + 1);
  return domain.includes('.');
}

export function validMoneyCents(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100000000;
}
