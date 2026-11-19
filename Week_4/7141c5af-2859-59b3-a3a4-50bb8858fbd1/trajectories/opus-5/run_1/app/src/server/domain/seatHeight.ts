/**
 * The seat height is typed the local way and answered as a Latin decimal
 * string. The typed text itself is stored exactly as typed.
 */
import { cmp, fromInt, parseDec, toPlain, type Dec } from './decimal.ts';
import type { Language } from '../../shared/language.ts';

interface NumberForm {
  /** The code point of this form's zero digit. */
  readonly zero: number;
  readonly separator: string;
}

const LATIN: NumberForm = { zero: 0x30, separator: '.' };
const ITALIAN: NumberForm = { zero: 0x30, separator: ',' };
const FULL_WIDTH: NumberForm = { zero: 0xff10, separator: '\uff0e' };
const ARABIC_INDIC: NumberForm = { zero: 0x0660, separator: '\u066b' };

const FORMS: Record<Language, readonly NumberForm[]> = {
  en: [LATIN],
  it: [ITALIAN],
  ja: [LATIN, FULL_WIDTH],
  ar: [ARABIC_INDIC, LATIN],
};

const MIN = fromInt(30);
const MAX = fromInt(60);

export type SeatHeightResult =
  | { kind: 'ok'; value: Dec; text: string }
  | { kind: 'blank' }
  | { kind: 'refused' };

function toLatinDigits(text: string, form: NumberForm): string | null {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const digit = code - form.zero;
    if (digit >= 0 && digit <= 9) {
      out += String(digit);
    } else if (ch === form.separator) {
      out += '.';
    } else {
      return null;
    }
  }
  return out;
}

/** Reads the height for the page's language, from 30 to 60 with one decimal at most. */
export function readSeatHeight(typed: string, language: Language): SeatHeightResult {
  if (typed.trim().length === 0) return { kind: 'blank' };
  const text = typed.trim();
  for (const form of FORMS[language]) {
    const latin = toLatinDigits(text, form);
    if (latin === null) continue;
    const parsed = parseDec(latin);
    if (!parsed || parsed.scale > 1) continue;
    if (cmp(parsed, MIN) < 0 || cmp(parsed, MAX) > 0) return { kind: 'refused' };
    return { kind: 'ok', value: parsed, text: typed };
  }
  return { kind: 'refused' };
}

/** The answered decimal string, always with a Latin point. */
export function seatHeightText(value: Dec): string {
  return toPlain(value);
}
