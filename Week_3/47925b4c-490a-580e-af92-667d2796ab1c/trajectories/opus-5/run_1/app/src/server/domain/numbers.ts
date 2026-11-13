import { fieldCopy } from '../http/fields.js';
import { type Decimal, parseDecimal } from './decimal.js';

export type NumberRefusal = typeof fieldCopy.thousands | typeof fieldCopy.badNumber;

export type EnteredNumber = { readonly ok: true; readonly value: Decimal } | { readonly ok: false; readonly copy: NumberRefusal };

const PLAIN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const GROUPED = /[0-9][ \u00a0\u2009'\u2019][0-9]/;
const MAX_CHARACTERS = 18;

/**
 * Reads the published number grammar: RFC 8259 without an exponent, a comma or
 * point as the decimal mark, at most 18 characters.
 */
export function parseEnteredNumber(text: string, negatives: 'allowed' | 'refused'): EnteredNumber {
  const marks = (text.match(/[,.]/g) ?? []).length;
  if (marks >= 2 || (text.includes(',') && text.includes('.')) || GROUPED.test(text)) {
    return { ok: false, copy: fieldCopy.thousands };
  }
  if (text.length > MAX_CHARACTERS) return { ok: false, copy: fieldCopy.badNumber };
  const plain = text.replace(',', '.');
  if (!PLAIN.test(plain)) return { ok: false, copy: fieldCopy.badNumber };
  if (plain.startsWith('-')) {
    if (negatives === 'refused') return { ok: false, copy: fieldCopy.badNumber };
    if (/^-0(?:\.0+)?$/.test(plain)) return { ok: false, copy: fieldCopy.badNumber };
  }
  return { ok: true, value: parseDecimal(plain) };
}
