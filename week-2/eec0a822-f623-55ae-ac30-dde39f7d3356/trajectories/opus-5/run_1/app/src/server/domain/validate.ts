import { FIELD_ERRORS } from '../../shared/copy.js';
import { validation } from '../http/errors.js';
import { isValidDateString, isValidTimeString } from '../../shared/zone.js';

export class Fields {
  private readonly errors: Record<string, string> = {};

  fail(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  get failed(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  has(field: string): boolean {
    return field in this.errors;
  }

  throwIfFailed(): void {
    if (this.failed) throw validation(this.errors);
  }

  text(field: string, value: unknown, maxLength: number): string {
    if (typeof value !== 'string' || value.trim() === '') {
      this.fail(field, FIELD_ERRORS.required);
      return '';
    }
    const trimmed = value.trim();
    if ([...trimmed].length > maxLength) {
      this.fail(field, FIELD_ERRORS.maxLength(maxLength));
      return trimmed;
    }
    return trimmed;
  }

  email(field: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
      this.fail(field, FIELD_ERRORS.required);
      return '';
    }
    const trimmed = value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || [...trimmed].length > 254) {
      this.fail(field, FIELD_ERRORS.email);
      return trimmed;
    }
    return trimmed;
  }

  password(field: string, value: unknown): string {
    if (typeof value !== 'string' || value === '') {
      this.fail(field, FIELD_ERRORS.required);
      return '';
    }
    if ([...value].length < 10) {
      this.fail(field, FIELD_ERRORS.password);
    }
    return value;
  }

  option<T extends string>(field: string, value: unknown, options: readonly T[]): T {
    if (typeof value !== 'string' || value === '') {
      this.fail(field, FIELD_ERRORS.required);
      return options[0];
    }
    if (!options.includes(value as T)) {
      this.fail(field, FIELD_ERRORS.options);
      return options[0];
    }
    return value as T;
  }

  wholeNumber(field: string, value: unknown, min: number, max: number): number {
    if (value === undefined || value === null || value === '') {
      this.fail(field, FIELD_ERRORS.required);
      return min;
    }
    const parsed = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      this.fail(field, FIELD_ERRORS.wholeRange(min, max));
      return min;
    }
    return parsed;
  }

  date(field: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
      this.fail(field, FIELD_ERRORS.required);
      return '';
    }
    const trimmed = value.trim();
    if (!isValidDateString(trimmed)) {
      this.fail(field, FIELD_ERRORS.dateFormat);
      return trimmed;
    }
    return trimmed;
  }

  time(field: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
      this.fail(field, FIELD_ERRORS.required);
      return '';
    }
    const trimmed = value.trim();
    if (!isValidTimeString(trimmed)) {
      this.fail(field, FIELD_ERRORS.timeFormat);
      return trimmed;
    }
    return trimmed;
  }

  /** Metres with at most two decimals, returned in whole centimetres. */
  metres(field: string, value: unknown, minCm: number, maxCm: number): number {
    if (value === undefined || value === null || value === '') {
      this.fail(field, FIELD_ERRORS.required);
      return minCm;
    }
    const raw = typeof value === 'number' ? formatNumber(value) : String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) {
      this.fail(field, FIELD_ERRORS.numberRange(metresText(minCm), metresText(maxCm)));
      return minCm;
    }
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
    if (decimals > 2) {
      this.fail(field, FIELD_ERRORS.twoDecimals);
      return minCm;
    }
    const [units, fraction = ''] = raw.split('.');
    const centimetres = Number.parseInt(units, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0'), 10);
    if (centimetres < minCm || centimetres > maxCm) {
      this.fail(field, FIELD_ERRORS.numberRange(metresText(minCm), metresText(maxCm)));
      return minCm;
    }
    return centimetres;
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function metresText(centimetres: number): string {
  return `${Math.floor(centimetres / 100)}.${String(centimetres % 100).padStart(2, '0')}`;
}
