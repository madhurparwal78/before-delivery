// API validation helpers: every field check comes back from the server through
// the shared 422 shape, with paths like lines.0.quantity.
import { ApiError } from '../domain/errors.js';
import { graphemeCount } from '../domain/danish.js';

export type Fields = Record<string, string>;

export class Validator {
  readonly fields: Fields = {};
  add(path: string, message: string): void {
    if (!(path in this.fields)) this.fields[path] = message;
  }
  throwIfAny(): void {
    if (Object.keys(this.fields).length > 0) {
      throw new ApiError('validation_failed', { fields: this.fields });
    }
  }
}

export function requiredString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function graphemeLimit(v: string, max: number): boolean {
  return graphemeCount(v) <= max;
}

export function wholeNumber(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// A shopper's name: trimmed, each run of line breaks with its surrounding spaces
// becomes one space before storing.
export function normaliseName(raw: string): string {
  return raw.replace(/\s*\r?\n\s*(?:\r?\n\s*)+/g, ' ').replace(/[ \t]+/g, ' ').trim();
}
