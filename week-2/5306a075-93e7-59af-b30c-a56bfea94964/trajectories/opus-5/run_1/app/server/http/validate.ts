import { validationFailed } from '../errors';

/** Input is validated once, here at the API boundary. */
export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get any(): boolean {
    return Object.keys(this.fields).length > 0;
  }

  throwIfAny(): void {
    if (this.any) throw validationFailed({ ...this.fields });
  }
}

export function failField(field: string, message: string): never {
  throw validationFailed({ [field]: message });
}

export function hasKey(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export const EFFORT_MESSAGE = 'Effort must be a whole number from 1 to 100.';
export const CONFIDENCE_MESSAGE = 'Confidence must be a whole number from 10 to 100.';
export const WEIGHT_MESSAGE = 'Weight must be a whole number from 0 to 100.';

export function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}
