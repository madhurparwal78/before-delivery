/**
 * Field validation. Every failure is collected into the one 422 shape, so a
 * request reports all of its bad fields at once.
 */

import { validation, type FieldCode } from "./errors.js";

export class FieldErrors {
  private readonly fields: Record<string, FieldCode> = {};

  set(field: string, code: FieldCode): void {
    if (!(field in this.fields)) this.fields[field] = code;
  }

  get hasAny(): boolean {
    return Object.keys(this.fields).length > 0;
  }

  throwIfAny(): void {
    if (this.hasAny) throw validation(this.fields);
  }
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A required text field: present, a string, and not only whitespace. */
export function requiredString(
  errors: FieldErrors,
  field: string,
  value: unknown,
  limits?: { max?: number; min?: number },
): string {
  const text = asString(value);
  if (text === null || text.trim().length === 0) {
    errors.set(field, "required");
    return "";
  }
  const trimmed = text.trim();
  if (limits?.max !== undefined && trimmed.length > limits.max) errors.set(field, "too_long");
  if (limits?.min !== undefined && trimmed.length < limits.min) errors.set(field, "too_short");
  return trimmed;
}

export function optionalString(
  errors: FieldErrors,
  field: string,
  value: unknown,
  limits?: { max?: number },
): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = asString(value);
  if (text === null) {
    errors.set(field, "invalid");
    return null;
  }
  const trimmed = text.trim();
  if (limits?.max !== undefined && trimmed.length > limits.max) errors.set(field, "too_long");
  return trimmed.length === 0 ? null : trimmed;
}

export function requiredInteger(
  errors: FieldErrors,
  field: string,
  value: unknown,
  range: { min: number; max: number },
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.set(field, value === undefined || value === null ? "required" : "invalid");
    return range.min;
  }
  if (value < range.min || value > range.max) {
    errors.set(field, "out_of_range");
    return range.min;
  }
  return value;
}

export function optionalInteger(
  errors: FieldErrors,
  field: string,
  value: unknown,
  range: { min: number; max: number },
): number | null {
  if (value === undefined || value === null) return null;
  return requiredInteger(errors, field, value, range);
}

export function oneOf<T extends string>(
  errors: FieldErrors,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  const text = asString(value);
  if (text === null) {
    errors.set(field, "required");
    return allowed[0] as T;
  }
  if (!(allowed as readonly string[]).includes(text)) {
    errors.set(field, "invalid");
    return allowed[0] as T;
  }
  return text as T;
}
