import { invalid } from './errors';

export type Json = Record<string, unknown>;

export const objectBody = (body: unknown): Json => (typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Json) : {});

export const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

export const intIn = (value: unknown, min: number, max: number): value is number => isInt(value) && value >= min && value <= max;

/** Collects field errors and throws the 422 once. */
export class Errors {
  private readonly found: Record<string, string> = {};

  add(field: string, message: string): void {
    this.found[field] ??= message;
  }

  get any(): boolean {
    return Object.keys(this.found).length > 0;
  }

  check(): void {
    if (this.any) throw invalid(this.found);
  }
}

export const bytesOf = (rows: unknown): number[][] | null =>
  Array.isArray(rows) && rows.every((row) => Array.isArray(row) && row.every((v) => isInt(v) && v >= 0)) ? (rows as number[][]) : null;
