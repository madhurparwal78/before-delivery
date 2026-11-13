import { AppError } from '../errors.js';

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw new AppError('validation_failed', { fields: this.fields });
  }
}

export function readText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function readInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return null;
}

export function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === 'string') ? (value as string[]) : null;
}

export function readQueryInteger(value: unknown): number | null {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
  return Number(value);
}

export function readQueryText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
