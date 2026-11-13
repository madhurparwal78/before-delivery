export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type FieldErrors = Record<string, string>;

export interface ParsedBody {
  raw: string | null;
  json: unknown;
  jsonError: boolean;
}

export function parseJsonBody(raw: string): { json: unknown; error: boolean } {
  try {
    return { json: JSON.parse(raw), error: false };
  } catch {
    return { json: undefined, error: true };
  }
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function validationError(fields: FieldErrors): AppError {
  const first = Object.keys(fields)[0];
  return new AppError(422, 'validation', fields[first], { fields });
}

export function required(records: Record<string, unknown>, fields: string[], errors: FieldErrors, messages: Record<string, string>): void {
  for (const f of fields) {
    const v = records[f];
    if (v === undefined || v === null || v === '') {
      errors[f] = messages[f] ?? "can't be blank.";
    }
  }
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return parseInt(v, 10);
  return null;
}

export function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

export function strList(v: unknown): string[] | null {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  return null;
}

export function pick<T extends object, K extends keyof T>(v: T, k: K): T[K] {
  return v[k];
}

export const ERROR_PRECEDENCE = [413, 400, 401, 429, 404, 403, 409, 422, 503] as const;

export function firstErrorByPrecedence(errors: AppError[]): AppError {
  for (const status of ERROR_PRECEDENCE) {
    const found = errors.find((e) => e.status === status);
    if (found) return found;
  }
  return errors[0];
}
