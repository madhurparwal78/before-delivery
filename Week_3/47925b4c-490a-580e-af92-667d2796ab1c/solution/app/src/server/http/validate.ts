import type { Decimal } from '../domain/decimal.js';
import { parseEnteredNumber } from '../domain/numbers.js';
import { fieldCopy } from './fields.js';
import { problem } from './problem.js';

export interface Shape {
  readonly [member: string]: Shape | true;
}

export const QUANTITY_SHAPE: Shape = { text: true, unit: true };

/** Refuses any member the endpoint does not list, at any depth. */
export function checkMembers(value: unknown, shape: Shape): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  for (const member of Object.keys(value as Record<string, unknown>)) {
    const allowed = Object.hasOwn(shape, member) ? shape[member] : Object.hasOwn(shape, '*') ? shape['*'] : undefined;
    if (allowed === undefined) throw problem('unknown_field', { placeholders: { field: member } });
    if (allowed === true) continue;
    const child = (value as Record<string, unknown>)[member];
    if (Array.isArray(child)) {
      for (const item of child) checkMembers(item, allowed);
    } else {
      checkMembers(child, allowed);
    }
  }
}

export class Validation {
  private readonly errors: Record<string, string> = {};

  add(pointer: string, copy: string): void {
    if (!(pointer in this.errors)) this.errors[pointer] = copy;
  }

  get failed(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  finish(): void {
    if (this.failed) {
      throw problem('validation_failed', { extensions: { errors: { ...this.errors } } });
    }
  }

  collected(): Record<string, string> {
    return { ...this.errors };
  }
}

/** A string member whose own rule judges an empty value; only a missing member is `required`. */
export function readText(check: Validation, body: Record<string, unknown>, member: string): string | null {
  const raw = body[member];
  if (typeof raw !== 'string') {
    check.add(`/${member}`, fieldCopy.required);
    return null;
  }
  return raw;
}

export function readString(check: Validation, body: Record<string, unknown>, member: string): string | null {
  const raw = body[member];
  if (raw === undefined || raw === null || raw === '') {
    check.add(`/${member}`, fieldCopy.required);
    return null;
  }
  if (typeof raw !== 'string') {
    check.add(`/${member}`, fieldCopy.required);
    return null;
  }
  return raw;
}

export function readBoolean(check: Validation, body: Record<string, unknown>, member: string): boolean | null {
  const raw = body[member];
  if (typeof raw !== 'boolean') {
    check.add(`/${member}`, fieldCopy.live);
    return null;
  }
  return raw;
}

export interface Quantity {
  readonly text: string;
  readonly unit: string;
  readonly value: Decimal;
}

export function readQuantity(
  check: Validation,
  body: Record<string, unknown>,
  member: string,
  units: readonly string[],
  negatives: 'allowed' | 'refused',
): Quantity | null {
  const raw = body[member];
  if (typeof raw === 'number') {
    check.add(`/${member}`, fieldCopy.badNumber);
    return null;
  }
  if (raw === undefined || raw === null) {
    check.add(`/${member}`, fieldCopy.required);
    return null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    check.add(`/${member}`, fieldCopy.badNumber);
    return null;
  }
  const parts = raw as Record<string, unknown>;
  const text = typeof parts['text'] === 'string' ? parts['text'] : null;
  const unit = typeof parts['unit'] === 'string' ? parts['unit'] : null;
  let value: Decimal | null = null;
  if (text === null) check.add(`/${member}/text`, fieldCopy.badNumber);
  else {
    const parsed = parseEnteredNumber(text, negatives);
    if (parsed.ok) value = parsed.value;
    else check.add(`/${member}/text`, parsed.copy);
  }
  if (unit === null || !units.includes(unit)) check.add(`/${member}/unit`, fieldCopy.badUnit);
  if (text === null || unit === null || value === null || !units.includes(unit)) return null;
  return { text, unit, value };
}

export function readNumberText(
  check: Validation,
  body: Record<string, unknown>,
  member: string,
  negatives: 'allowed' | 'refused',
): { readonly text: string; readonly value: Decimal } | null {
  const raw = body[member];
  if (typeof raw === 'number') {
    check.add(`/${member}`, fieldCopy.badNumber);
    return null;
  }
  if (raw === undefined || raw === null) {
    check.add(`/${member}`, fieldCopy.required);
    return null;
  }
  if (typeof raw !== 'string') {
    check.add(`/${member}`, fieldCopy.badNumber);
    return null;
  }
  const parsed = parseEnteredNumber(raw, negatives);
  if (!parsed.ok) {
    check.add(`/${member}`, parsed.copy);
    return null;
  }
  return { text: raw, value: parsed.value };
}

export function readWholeNumber(
  check: Validation,
  body: Record<string, unknown>,
  member: string,
  copy: string,
  low: number,
  high: number,
): number | null {
  const raw = body[member];
  if (raw === undefined || raw === null) {
    check.add(`/${member}`, fieldCopy.required);
    return null;
  }
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < low || value > high) {
    check.add(`/${member}`, copy);
    return null;
  }
  return value;
}

export function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw problem('malformed_body');
  return value as Record<string, unknown>;
}
