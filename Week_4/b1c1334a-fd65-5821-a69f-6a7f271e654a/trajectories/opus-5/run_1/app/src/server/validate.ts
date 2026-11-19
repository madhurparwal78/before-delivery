import { fieldMessages } from '../shared/copy.js';
import { formatDecimal, parseDecimalText, round, DISPLAY_SCALE } from './decimal.js';
import { asBoolean, asString, RawNumber } from './json.js';
import type { ColumnData, TableData } from './model.js';
import { parseDateText } from './value.js';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export function countCharacters(text: string): number {
  return Array.from(text).length;
}

export function isValidDocumentName(name: string): boolean {
  const length = countCharacters(name);
  return length >= 1 && length <= 80 && !CONTROL_CHARACTERS.test(name);
}

export function isValidTableName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name);
}

export function isValidColumnName(name: string): boolean {
  const length = countCharacters(name);
  return length >= 1 && length <= 60 && !name.includes('[') && !name.includes(']');
}

export function isValidEmail(email: string): boolean {
  if (countCharacters(email) > 254) return false;
  if (/[\s\u0000-\u001f\u007f-\u009f,;<>"()]/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  return (parts[0] ?? '').length > 0 && (parts[1] ?? '').length > 0;
}

export function isValidIdempotencyKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,100}$/.test(key);
}

export type ParsedValue = { raw: string | null } | { error: string };

/** The one place a written value is checked against its column type. */
export function parseCellValue(
  column: ColumnData,
  value: unknown,
  context: {
    targetTable: TableData | null;
    referenceIsVisible: (rowId: string) => boolean;
  },
): ParsedValue {
  if (value === null || value === '') return { raw: null };
  switch (column.type) {
    case 'text': {
      const text = asString(value);
      if (text === null) return { error: fieldMessages.text };
      if (countCharacters(text) > 10_000) return { error: fieldMessages.textTooLong };
      return { raw: text };
    }
    case 'decimal': {
      const text = value instanceof RawNumber ? value.text : asString(value);
      if (text === null) return { error: fieldMessages.decimal };
      const parsed = parseDecimalText(text);
      if (parsed === null) return { error: fieldMessages.decimal };
      return { raw: formatDecimal(round(parsed, DISPLAY_SCALE)) };
    }
    case 'date': {
      const text = asString(value);
      if (text === null || parseDateText(text) === null) return { error: fieldMessages.date };
      return { raw: text };
    }
    case 'bool': {
      const direct = asBoolean(value);
      if (direct !== null) return { raw: direct ? 'true' : 'false' };
      const text = asString(value);
      if (text !== null && text.toLowerCase() === 'true') return { raw: 'true' };
      if (text !== null && text.toLowerCase() === 'false') return { raw: 'false' };
      return { error: fieldMessages.bool };
    }
    case 'reference': {
      const name = context.targetTable?.name ?? '';
      const text = asString(value);
      if (text === null || !context.referenceIsVisible(text)) {
        return { error: fieldMessages.reference(name) };
      }
      return { raw: text };
    }
    case 'formula':
      return { error: fieldMessages.formulaCell };
  }
}

/** Converting a column's values to a new type reads each display with the new type's rule. */
export function convertDisplayToType(display: string, type: ColumnData['type']): string | null {
  const text = display.trim();
  if (text === '') return null;
  switch (type) {
    case 'text':
      return display;
    case 'decimal': {
      const parsed = parseDecimalText(text);
      return parsed === null ? null : formatDecimal(round(parsed, DISPLAY_SCALE));
    }
    case 'date':
      return parseDateText(text) === null ? null : text;
    case 'bool': {
      const lower = text.toLowerCase();
      if (lower === 'true') return 'true';
      if (lower === 'false') return 'false';
      return null;
    }
    case 'reference':
    case 'formula':
      return null;
  }
}
