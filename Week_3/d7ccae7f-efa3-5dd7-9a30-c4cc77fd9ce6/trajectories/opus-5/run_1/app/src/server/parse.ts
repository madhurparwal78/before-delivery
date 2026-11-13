import { validationFailed } from './errors.js';

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects per-field messages so one request reports every bad field at once. */
export class FieldErrors {
  private readonly fields = new Map<string, string>();

  add(field: string, message: string): void {
    if (!this.fields.has(field)) this.fields.set(field, message);
  }

  get empty(): boolean {
    return this.fields.size === 0;
  }

  throwIfAny(): void {
    if (this.fields.size > 0) {
      throw validationFailed(Object.fromEntries(this.fields));
    }
  }
}

export function readString(body: Json, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

export function readNumber(body: Json, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readInteger(body: Json, key: string): number | null {
  const value = readNumber(body, key);
  return value !== null && Number.isInteger(value) ? value : null;
}

export function readStringArray(body: Json, key: string): string[] | null {
  const value = body[key];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    out.push(entry);
  }
  return out;
}

export function parseJsonObject(text: string): Json {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw validationFailed({ body: 'Send a JSON object.' });
  }
  if (!isRecord(parsed)) throw validationFailed({ body: 'Send a JSON object.' });
  return parsed;
}
