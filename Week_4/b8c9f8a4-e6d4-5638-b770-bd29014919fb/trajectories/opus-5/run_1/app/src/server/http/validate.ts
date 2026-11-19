import { validationFailure } from '../domain/errors';

export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.errors[field] === undefined) this.errors[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw validationFailure(this.errors);
  }
}

export const asRecord = (body: unknown): Record<string, unknown> =>
  typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

export const textField = (
  errors: FieldErrors,
  value: unknown,
  field: string,
  min: number,
  max: number,
): string => {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    errors.add(field, `Enter between ${min} and ${max} characters`);
    return '';
  }
  return value;
};

export const integerField = (
  errors: FieldErrors,
  value: unknown,
  field: string,
  min: number,
  max: number,
  message = `Enter a whole number from ${min} to ${max}`,
): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errors.add(field, message);
    return min;
  }
  return value;
};

export const fractionField = (errors: FieldErrors, value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    errors.add(field, 'Enter a number from 0 to 1');
    return 0;
  }
  return value;
};

export const enumField = <T extends string>(
  errors: FieldErrors,
  value: unknown,
  field: string,
  allowed: readonly T[],
): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.add(field, `Choose one of ${allowed.join(', ')}`);
    return allowed[0];
  }
  return value as T;
};

/** Uppercased with spaces removed, 2 to 7 letters or digits, stored in exactly that form. */
export const normaliseRegistration = (errors: FieldErrors, value: unknown): string => {
  if (typeof value !== 'string') {
    errors.add('registration', 'Enter the registration');
    return '';
  }
  const normalised = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{2,7}$/.test(normalised)) {
    errors.add('registration', 'Enter 2 to 7 letters or digits');
    return '';
  }
  return normalised;
};
