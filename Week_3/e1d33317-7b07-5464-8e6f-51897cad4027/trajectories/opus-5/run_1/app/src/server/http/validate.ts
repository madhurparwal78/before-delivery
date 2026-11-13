import { graphemeCount } from '../../shared/text.js';
import { errors, type FieldErrors } from '../errors.js';

export class FieldCollector {
  private readonly found: FieldErrors = {};

  add(field: string, message: string): void {
    if (!(field in this.found)) this.found[field] = message;
  }

  get failed(): boolean {
    return Object.keys(this.found).length > 0;
  }

  throwIfFailed(): void {
    if (this.failed) throw errors.validation(this.found);
  }
}

export function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

export function trimmedName(
  value: unknown,
  limit: number,
): { name: string; problem: string | null } {
  if (typeof value !== 'string') {
    return { name: '', problem: `Use 1 to ${limit} characters.` };
  }
  const name = value.trim();
  const length = graphemeCount(name);
  if (length < 1 || length > limit) {
    return { name, problem: `Use 1 to ${limit} characters.` };
  }
  return { name, problem: null };
}

export function wholeNumber(value: unknown, low: number, high: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
    return null;
  }
  return value;
}

export function queryNumber(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

export function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((item) => typeof item !== 'string')) return null;
  return value as string[];
}
