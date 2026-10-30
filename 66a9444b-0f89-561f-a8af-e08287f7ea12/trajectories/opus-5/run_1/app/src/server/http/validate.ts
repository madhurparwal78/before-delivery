import { ValidationError, type FieldErrors } from '../lib/errors.js';

export function expectObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asTrimmed(value: unknown): string | null {
  const text = asString(value);
  if (text === null) return null;
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return value as string[];
}

export class ErrorBag {
  private readonly errors: FieldErrors = {};

  add(field: string, code: string): void {
    this.errors[field] ??= code;
  }

  get empty(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw new ValidationError(this.errors);
  }
}

export function fail(field: string, code: string): never {
  throw new ValidationError({ [field]: code });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value) && value.length <= 200;
}
