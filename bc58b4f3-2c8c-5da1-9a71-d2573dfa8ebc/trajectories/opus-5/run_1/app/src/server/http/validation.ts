import { fail } from './errors.js';

export interface FieldErrors {
  add(field: string, message: string): void;
  has(field: string): boolean;
  any(): boolean;
  finish(): void;
}

export function fieldErrors(): FieldErrors {
  const errors: Record<string, string> = {};
  return {
    add(field, message) {
      if (errors[field] === undefined) errors[field] = message;
    },
    has(field) {
      return errors[field] !== undefined;
    },
    any() {
      return Object.keys(errors).length > 0;
    },
    finish() {
      if (Object.keys(errors).length > 0) fail('validation', errors);
    },
  };
}

export function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function integerOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Numbers that arrive as typed text, as the rate form and uploads send them. */
export function integerFromText(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return null;
  return Number.parseInt(value.trim(), 10);
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
