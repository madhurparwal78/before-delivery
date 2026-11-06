import { invalidFields } from './errors';

/** Field validation that lists every failing field at once. */
export class FieldCheck {
  private readonly failures: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.failures[field] === undefined) this.failures[field] = message;
  }

  get any(): boolean {
    return Object.keys(this.failures).length > 0;
  }

  settle(): void {
    if (this.any) throw invalidFields(this.failures);
  }
}

export function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export function codePoints(value: string): number {
  return [...value].length;
}

export function readText(body: unknown, field: string): string | null {
  const value = asRecord(body)[field];
  return typeof value === 'string' ? value : null;
}

export function hasKey(body: unknown, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(asRecord(body), field);
}

export function readInteger(body: unknown, field: string): bigint | null {
  const value = asRecord(body)[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return BigInt(value);
}

export function readFlag(body: unknown, field: string): boolean | null {
  const value = asRecord(body)[field];
  return typeof value === 'boolean' ? value : null;
}

export const ADDRESS_SHAPE = /^lnl1[a-z0-9]{30}$/;

export function isAddress(value: string): boolean {
  return ADDRESS_SHAPE.test(value);
}
