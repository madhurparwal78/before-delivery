import { ApiError } from './errors.js';

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.fields[field] === undefined) {
      this.fields[field] = message;
    }
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) {
      throw new ApiError('validation', this.fields);
    }
  }
}

export function parseJsonBody(raw: Buffer): Record<string, unknown> {
  const text = raw.toString('utf8');
  let value: unknown;
  try {
    value = text === '' ? {} : JSON.parse(text);
  } catch {
    throw new ApiError('validation', { body: 'Send a JSON object.' });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('validation', { body: 'Send a JSON object.' });
  }
  return value as Record<string, unknown>;
}

export function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

export function integerField(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
