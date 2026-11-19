/**
 * Field validation. Each refusal reads its published copy and lands in one
 * `fields` map, so a Problems summary can link to every refused field.
 */
import { F } from '../../shared/feedback.ts';
import { parseDec, type Dec } from '../domain/decimal.ts';
import { parseDate, parseTime, type CalendarDate } from '../domain/time.ts';
import { fail } from './errors.ts';
import type { JsonObject } from './request.ts';

export const LIMITS = {
  clientName: 120,
  pieceTitle: 120,
  maker: 120,
  enquiryName: 120,
  year: 40,
  pinNote: 2000,
  pieceNotes: 2000,
  enquiryMessage: 5000,
  email: 254,
} as const;

/** Code points, so an emoji counts as one. */
export function lengthInCodePoints(text: string): number {
  return [...text].length;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Check {
  private readonly errors: Record<string, string> = {};

  constructor(private readonly body: JsonObject) {}

  private refuse<T>(key: string, message: string): T | null {
    if (!(key in this.errors)) this.errors[key] = message;
    return null;
  }

  has(key: string): boolean {
    return this.body[key] !== undefined;
  }

  raw(key: string): unknown {
    return this.body[key];
  }

  /** A required text field with a length limit. */
  text(key: string, limit: number): string | null {
    const value = this.body[key];
    if (value === undefined || value === null || value === '') return this.refuse(key, F.required);
    if (typeof value !== 'string') return this.refuse(key, F.required);
    if (value.trim().length === 0) return this.refuse(key, F.required);
    if (lengthInCodePoints(value) > limit) return this.refuse(key, F.tooLong(limit));
    return value;
  }

  /** An optional text field; an absent key stays absent, an empty one is empty. */
  optionalText(key: string, limit: number): string | null | undefined {
    const value = this.body[key];
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') return this.refuse(key, F.required);
    if (lengthInCodePoints(value) > limit) return this.refuse(key, F.tooLong(limit));
    return value;
  }

  email(key: string, required = true): string | null | undefined {
    const value = this.body[key];
    if (value === undefined || value === null || value === '') {
      return required ? this.refuse(key, F.required) : value === undefined ? undefined : null;
    }
    if (typeof value !== 'string') return this.refuse(key, F.notEmail);
    if (lengthInCodePoints(value) > LIMITS.email) return this.refuse(key, F.tooLong(LIMITS.email));
    if (!EMAIL.test(value)) return this.refuse(key, F.notEmail);
    return value;
  }

  password(key: string): string | null {
    const value = this.body[key];
    if (value === undefined || value === null || value === '') return this.refuse(key, F.required);
    if (typeof value !== 'string') return this.refuse(key, F.required);
    if (lengthInCodePoints(value) < 10) return this.refuse(key, F.shortPassword);
    return value;
  }

  choice<T extends string>(key: string, options: readonly T[], required = true): T | null | undefined {
    const value = this.body[key];
    if (value === undefined) return required ? this.refuse(key, F.required) : undefined;
    if (value === null) return required ? this.refuse(key, F.required) : null;
    if (typeof value !== 'string' || !options.includes(value as T)) {
      return this.refuse(key, F.outOfRange);
    }
    return value as T;
  }

  date(key: string, required = true): CalendarDate | null | undefined {
    const value = this.body[key];
    if (value === undefined) return required ? this.refuse(key, F.required) : undefined;
    if (value === null || value === '') return required ? this.refuse(key, F.required) : null;
    if (typeof value !== 'string') return this.refuse(key, F.notDate);
    const parsed = parseDate(value);
    if (!parsed) return this.refuse(key, F.notDate);
    return parsed;
  }

  time(key: string): { hour: number; minute: number } | null {
    const value = this.body[key];
    if (value === undefined || value === null || value === '') return this.refuse(key, F.required);
    if (typeof value !== 'string') return this.refuse(key, F.notTime);
    const parsed = parseTime(value);
    if (!parsed) return this.refuse(key, F.notTime);
    return parsed;
  }

  /**
   * A decimal field, read exactly from a decimal string or a JSON number. Any
   * other form reads F-112; a value outside the field's own range reads F-08.
   */
  decimal(
    key: string,
    options: { required?: boolean; min?: Dec; max?: Dec; maxScale?: number } = {},
  ): Dec | null | undefined {
    const required = options.required ?? true;
    const value = this.body[key];
    if (value === undefined) return required ? this.refuse(key, F.required) : undefined;
    if (value === null || value === '') return required ? this.refuse(key, F.required) : null;

    let parsed: Dec | null = null;
    if (typeof value === 'number') {
      parsed = Number.isFinite(value) ? parseDec(formatJsonNumber(value)) : null;
    } else if (typeof value === 'string') {
      parsed = parseDec(value);
    }
    if (!parsed) return this.refuse(key, F.notNumber);
    if (parsed.units < 0n && options.min === undefined) return this.refuse(key, F.outOfRange);
    if (options.maxScale !== undefined && parsed.scale > options.maxScale) {
      return this.refuse(key, F.outOfRange);
    }
    if (options.min !== undefined && compare(parsed, options.min) < 0) {
      return this.refuse(key, F.outOfRange);
    }
    if (options.max !== undefined && compare(parsed, options.max) > 0) {
      return this.refuse(key, F.outOfRange);
    }
    return parsed;
  }

  /** A whole-number field. */
  integer(key: string, options: { required?: boolean; min?: number; max?: number } = {}): number | null | undefined {
    const required = options.required ?? true;
    const value = this.body[key];
    if (value === undefined) return required ? this.refuse(key, F.required) : undefined;
    if (value === null || value === '') return required ? this.refuse(key, F.required) : null;
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed)) return this.refuse(key, F.notNumber);
    if (!Number.isInteger(parsed)) return this.refuse(key, F.outOfRange);
    if (options.min !== undefined && parsed < options.min) return this.refuse(key, F.outOfRange);
    if (options.max !== undefined && parsed > options.max) return this.refuse(key, F.outOfRange);
    return parsed;
  }

  boolean(key: string): boolean {
    return this.body[key] === true;
  }

  /** Records a refusal decided by a rule of the field's own. */
  add(key: string, message: string): void {
    if (!(key in this.errors)) this.errors[key] = message;
  }

  get failed(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  /** Throws the one 422 for everything refused, in the order it was checked. */
  done(): void {
    if (this.failed) throw fail.fields(this.errors);
  }
}

function compare(a: Dec, b: Dec): number {
  const scale = Math.max(a.scale, b.scale);
  const pow = (n: number): bigint => 10n ** BigInt(n);
  const left = a.units * pow(scale - a.scale);
  const right = b.units * pow(scale - b.scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A JSON number's exact decimal text, never its float rendering. */
function formatJsonNumber(value: number): string {
  const text = String(value);
  return text.includes('e') || text.includes('E') ? value.toFixed(20).replace(/0+$/, '') : text;
}

/** Query text over its published limit answers 422 within a second. */
export function checkQueryText(text: string, limit: number): void {
  if (lengthInCodePoints(text) > limit) throw fail.invalid(F.tooLong(limit));
}
