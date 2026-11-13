import { validation } from '../http/app-error.js';

export type FieldErrors = Record<string, string>;

export const isEmail = (value: unknown): value is string =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;

export const boundedText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;

export const check = (errors: FieldErrors): void => {
  if (Object.keys(errors).length > 0) validation(errors);
};
