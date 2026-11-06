import { FIELD_COPY } from '../../domain/copy.ts';
import { graphemeCount, isEmailShaped } from '../../domain/text.ts';
import { validationFailed } from './errors.ts';

export class Problems {
  private readonly fields: Record<string, string> = {};

  add(path: string, message: string): void {
    if (!(path in this.fields)) this.fields[path] = message;
  }

  get any(): boolean {
    return Object.keys(this.fields).length > 0;
  }

  throwIfAny(): void {
    if (this.any) throw validationFailed({ ...this.fields });
  }

  get map(): Record<string, string> {
    return { ...this.fields };
  }
}

export function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

export interface TextRules {
  min?: number;
  max?: number;
  /** When false a blank value is accepted. */
  required?: boolean;
}

export function text(
  problems: Problems,
  body: Record<string, unknown>,
  key: string,
  rules: TextRules = {},
  path = key,
): string {
  const raw = body[key];
  if (raw === undefined || raw === null) {
    if (rules.required !== false) problems.add(path, FIELD_COPY.required);
    return '';
  }
  if (typeof raw !== 'string') {
    problems.add(path, FIELD_COPY.required);
    return '';
  }
  const value = raw.trim();
  if (value === '' && rules.required !== false) {
    problems.add(path, FIELD_COPY.required);
    return value;
  }
  if (rules.max !== undefined && graphemeCount(value) > rules.max) {
    problems.add(path, FIELD_COPY.tooLong(rules.max));
  }
  return value;
}

export function email(
  problems: Problems,
  body: Record<string, unknown>,
  key: string,
  path = key,
): string {
  const value = text(problems, body, key, { max: 254 }, path);
  if (value !== '' && !isEmailShaped(value)) problems.add(path, FIELD_COPY.email);
  return value.toLowerCase();
}

export function integer(
  problems: Problems,
  body: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  path = key,
  fallback: number | null = null,
): number {
  const raw = body[key];
  if (raw === undefined || raw === null) {
    if (fallback !== null) return fallback;
    problems.add(path, FIELD_COPY.required);
    return min;
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.add(path, FIELD_COPY.range(min, max));
    return min;
  }
  return value;
}

export function boolean(body: Record<string, unknown>, key: string): boolean {
  return body[key] === true;
}

export function list(body: Record<string, unknown>, key: string): unknown[] {
  const value = body[key];
  return Array.isArray(value) ? value : [];
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
