import { ERRORS, ApiError } from './errors.ts';
import { PANEL_IDS } from '../shared/coat.ts';

/**
 * Field validation — the single place with the published messages.
 * Collects all field errors and answers 422 in one body.
 */

export interface ValidationErrors {
  [field: string]: string;
}

export class Validator {
  private errors: ValidationErrors = {};

  error(field: string, message: string): void {
    if (!(field in this.errors)) {
      this.errors[field] = message;
    }
  }

  check(ok: boolean, field: string, message: string): boolean {
    if (!ok) this.error(field, message);
    return ok;
  }

  throwIfInvalid(): void {
    if (Object.keys(this.errors).length > 0) {
      throw ERRORS.validation(this.errors);
    }
  }

  has(field: string): boolean {
    return field in this.errors;
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}

export function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function trimmed(value: unknown): string {
  return str(value).trim();
}

export function isBlank(value: unknown): boolean {
  return trimmed(value) === '';
}

export function num(value: unknown): number {
  const text = str(value).trim();
  if (text === '') return NaN;
  return Number(text);
}

export function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

/** 1-60 characters for make/model/colour/label. */
export function text1to60(v: Validator, field: string, value: unknown): string | null {
  const text = trimmed(value);
  if (!v.check(text.length >= 1 && text.length <= 60, field, 'Enter 1 to 60 characters.')) return null;
  return text;
}

export function text1to20(v: Validator, field: string, value: unknown): string | null {
  const text = trimmed(value);
  if (!v.check(text.length >= 1 && text.length <= 20, field, 'Enter 1 to 20 characters.')) return null;
  return text;
}

export function text1to120(v: Validator, field: string, value: unknown): string | null {
  const text = trimmed(value);
  if (!v.check(text.length >= 1 && text.length <= 120, field, 'Enter 1 to 120 characters.')) return null;
  return text;
}

export function quantity2dp(value: unknown): string | null {
  const match = /^(\d+)(\.\d{1,2})?$/.exec(str(value).trim());
  if (!match) return null;
  const [, whole, frac] = match;
  return `${whole}${(frac ?? '.').padEnd(3, '0')}`;
}

export function money2dp(value: unknown): string | null {
  const match = /^\d+(\.\d{1,2})?$/.exec(str(value).trim());
  return match ? str(value).trim() : null;
}

export interface LineInput {
  kind: string;
  description: string;
  quantity: string;
  unit_price: string | null;
}

export function validateLines(v: Validator, raw: unknown, labourRate: string): LineInput[] {
  const lines = Array.isArray(raw) ? raw : [];
  if (!v.check(lines.length >= 1, 'lines', 'Add at least one line.')) {
    return [];
  }
  const result: LineInput[] = [];
  lines.forEach((line, index) => {
    const record = asRecord(line);
    const kind = str(record['kind']);
    const okKind = ['part', 'labour', 'paint_materials'].includes(kind);
    if (!v.check(okKind, `lines[${index}].kind`, 'Choose a line kind.')) return;
    const description = text1to120(v, `lines[${index}].description`, record['description']);
    if (description === null) return;
    const quantityRaw = record['quantity'];
    let quantity: string | null = null;
    if (kind === 'part') {
      const value = num(quantityRaw);
      if (v.check(Number.isInteger(value) && value >= 1 && value <= 999, `lines[${index}].quantity`, 'Enter a whole number of parts from 1 to 999.')) {
        quantity = String(value);
      }
    } else if (kind === 'labour') {
      const value = num(quantityRaw);
      const quarterOk = Number.isFinite(value) && value >= 0.25 && value <= 200 && Math.abs(value * 4 - Math.round(value * 4)) < 1e-9;
      if (v.check(quarterOk, `lines[${index}].quantity`, 'Enter hours in quarter-hour steps from 0.25 to 200.00.')) {
        quantity = value.toFixed(2);
      }
    } else {
      const q = quantity2dp(quantityRaw);
      const value = num(quantityRaw);
      if (v.check(q !== null && value > 0, `lines[${index}].quantity`, 'Enter a quantity greater than zero with up to two decimals.')) {
        quantity = q as string;
      }
    }
    let unitPrice: string | null;
    if (kind === 'labour') {
      const price = record['unit_price'];
      if (price !== undefined && price !== null && String(price).trim() !== '') {
        v.error(`lines[${index}].unit_price`, 'Labour is billed at the house rate.');
        unitPrice = null;
      } else {
        unitPrice = labourRate;
      }
    } else {
      const value = num(record['unit_price']);
      if (v.check(Number.isFinite(value) && value >= 0.01 && value <= 99999.99, `lines[${index}].unit_price`, 'Enter a price in CHF from 0.01 to 99999.99.')) {
        unitPrice = str(record['unit_price']).trim();
      } else {
        unitPrice = null;
      }
    }
    if (description !== null && quantity !== null && unitPrice !== null) {
      result.push({ kind, description, quantity, unit_price: unitPrice });
    }
  });
  return result;
}

export function validatePanel(v: Validator, field: string, value: unknown): string | null {
  const panel = str(value).trim();
  if (!v.check(PANEL_IDS.includes(panel), field, 'Choose a panel from the list.')) return null;
  return panel;
}

export function validateFilmReading(v: Validator, field: string, value: unknown, unit: string): number | null {
  const number = num(value);
  if (unit === 'mil') {
    if (v.check(Number.isFinite(number) && number >= 0 && number <= 78.7, field, 'Enter a reading from 0.0 to 78.7 mil.')) {
      return Math.round(number * 25.4);
    }
    return null;
  }
  if (v.check(Number.isFinite(number) && Number.isInteger(number) && number >= 0 && number <= 2000, field, 'Enter a reading from 0 to 2000 µm.')) {
    return number;
  }
  return null;
}

export function requireRange(v: Validator, field: string, value: number, min: number, max: number, message: string): boolean {
  return v.check(Number.isFinite(value) && value >= min && value <= max, field, message);
}
