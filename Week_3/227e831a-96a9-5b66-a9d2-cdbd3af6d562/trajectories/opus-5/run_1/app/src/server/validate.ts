import { isCategory, type Category } from '../shared/categories.js';
import { isKnownTimeZone } from '../shared/sharetime.js';
import type { CarryMode, PaperSize } from '../shared/types.js';
import { toGrams, type DisplayUnit } from '../shared/weights.js';
import { validationFailed } from './http/errors.js';
import { integerOf, isPlainObject, numberTextOf, textOf } from './http/json.js';

export const MESSAGES = {
  name: 'Enter a name.',
  category: 'Choose a category.',
  weight: 'Enter a weight from 0 to 50000 g.',
  unitsOwned: 'Enter whole units from 1 to 99.',
  priceCents: 'Enter a price of 0 or more.',
  notes: 'Notes can be at most 1000 characters.',
  displayName: 'Enter a display name of up to 60 characters.',
  unit: 'Choose a display unit.',
  goal: 'Enter a goal from 1 to 50000 g.',
  timeZone: 'Choose a time zone.',
  paperSize: 'Choose A4 or Letter.',
  listName: 'Enter a list name of up to 80 characters.',
  quantityMin: 'Quantity must be at least 1.',
  mode: 'Choose base, worn or consumable.',
  reason: 'Choose a reason.',
  state: 'Choose planning, packed or walked.',
  ops: 'Send 1 to 200 changes.',
  expiresOn: 'Choose today or a later date.',
} as const;

/** Collects field messages so one 422 names every bad field at once. */
export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    this.fields[field] = message;
  }

  throwIfAny(): void {
    if (Object.keys(this.fields).length > 0) throw validationFailed(this.fields);
  }
}

export function trimmedText(value: unknown, min: number, max: number): string | null {
  const text = textOf(value);
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  return trimmed;
}

export function categoryOf(value: unknown): Category | null {
  return isCategory(value) ? value : null;
}

/** A weight input, converted to whole grams exactly and once. */
export function weightGramsOf(value: unknown): number | null {
  if (!isPlainObject(value)) return null;
  const text = numberTextOf(value['value']);
  const unit = textOf(value['unit']);
  if (text === null || (unit !== 'g' && unit !== 'oz')) return null;
  if (unit === 'oz') {
    const point = text.indexOf('.');
    if (point !== -1 && text.length - point - 1 > 2) return null;
  }
  const grams = toGrams(text, unit);
  if (grams === null || grams < 0 || grams > 50000) return null;
  return grams;
}

export function wholeIn(value: unknown, min: number, max: number): number | null {
  const parsed = integerOf(value);
  if (parsed === null || parsed < min || parsed > max) return null;
  return parsed;
}

export function displayUnitOf(value: unknown): DisplayUnit | null {
  return value === 'g' || value === 'oz' || value === 'lb' ? value : null;
}

export function paperSizeOf(value: unknown): PaperSize | null {
  return value === 'A4' || value === 'Letter' ? value : null;
}

export function timeZoneOf(value: unknown): string | null {
  const text = textOf(value);
  if (text === null || !isKnownTimeZone(text)) return null;
  return text;
}

export function carryModeOf(value: unknown): CarryMode | null {
  return value === 'base' || value === 'worn' || value === 'consumable' ? value : null;
}
