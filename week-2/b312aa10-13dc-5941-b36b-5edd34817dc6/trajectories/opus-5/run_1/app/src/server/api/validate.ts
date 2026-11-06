/** The accepted keys of each write body, and the published field errors. */
import { errors, fieldCopy } from '../http/errors.js';

export class FieldErrors {
  private readonly map: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.map)) this.map[field] = message;
  }

  get any(): boolean {
    return Object.keys(this.map).length > 0;
  }

  throwIfAny(): void {
    if (this.any) throw errors.validationFailed(this.map);
  }

  get collected(): Record<string, string> {
    return this.map;
  }
}

/**
 * Accepts only the published keys for the endpoint, taking defaults for the
 * optional ones. Any other key, and any missing required key, answers 422.
 */
export function exactBody(
  json: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const body = (json ?? {}) as Record<string, unknown>;
  if (typeof body !== 'object' || Array.isArray(body)) throw errors.badRequest();
  const fieldErrors = new FieldErrors();
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) fieldErrors.add(key, fieldCopy.cannotBeSet);
  }
  for (const key of required) {
    if (!(key in body)) fieldErrors.add(key, fieldCopy.required);
  }
  fieldErrors.throwIfAny();
  return body;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
