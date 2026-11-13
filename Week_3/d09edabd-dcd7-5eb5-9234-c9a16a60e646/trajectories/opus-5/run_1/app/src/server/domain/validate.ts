import { errors } from '../errors.js';
import type { FieldErrors } from '../errors.js';

export class FieldCollector {
  private readonly problems: FieldErrors = {};

  add(field: string, message: string): void {
    if (!(field in this.problems)) this.problems[field] = message;
  }

  get failed(): boolean {
    return Object.keys(this.problems).length > 0;
  }

  throwIfAny(): void {
    if (this.failed) throw errors.validation(this.problems);
  }
}

export function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw errors.field('body', 'must be an object');
  }
  return body as Record<string, unknown>;
}

export function has(body: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field);
}

export function text(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  collector: FieldCollector,
): string | null {
  const value = body[field];
  if (typeof value !== 'string') {
    collector.add(field, 'must be text');
    return null;
  }
  if (value.length < min || value.length > max) {
    collector.add(field, `must be ${min} to ${max} characters`);
    return null;
  }
  return value;
}

export function integer(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  collector: FieldCollector,
): number | null {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    collector.add(field, 'must be a whole number of millimetres');
    return null;
  }
  if (value < min || value > max) {
    collector.add(field, `must be ${min} to ${max}`);
    return null;
  }
  return value;
}

export function boolish(
  body: Record<string, unknown>,
  field: string,
  collector: FieldCollector,
): boolean | null {
  const value = body[field];
  if (typeof value !== 'boolean') {
    collector.add(field, 'must be true or false');
    return null;
  }
  return value;
}

export function email(
  body: Record<string, unknown>,
  field: string,
  collector: FieldCollector,
): string | null {
  const value = body[field];
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    collector.add(field, 'must be an email address');
    return null;
  }
  return value.trim();
}

export function opIdOf(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(raw)) throw errors.field('opId', 'must be 8 to 64 id characters');
  return raw;
}
