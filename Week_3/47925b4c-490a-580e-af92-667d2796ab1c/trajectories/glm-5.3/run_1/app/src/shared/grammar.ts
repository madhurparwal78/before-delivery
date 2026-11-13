// The published number grammar: RFC 8259 numbers without exponent, at most 18 characters,
// one decimal mark (',' or '.'), negative only where the caller allows it.

export interface NumberCheck {
  ok: boolean;
  fieldCopy: 'thousands' | 'badNumber';
  value: string | null;
}

const MAX_CHARS = 18;

export function thousandsSeparatorPresent(text: string): boolean {
  const marks = (text.match(/[.,]/g) ?? []).length;
  if (marks >= 2) return true; // two or more marks, or a comma and a point together
  if (/^[^,.]*,[^,.]*\./.test(text) || /^[^,.]*\.[^,.]*,/.test(text)) return true;
  if (/\d[ '’]\d/.test(text)) return true; // a space or apostrophe between digits
  if (/^\d{1,3}(\s\d{3})+([.,]\d+)?$/.test(text)) return true;
  return false;
}

export function parseNumberGrammar(text: string, allowNegative: boolean): NumberCheck {
  const fail = (copy: 'thousands' | 'badNumber'): NumberCheck => ({ ok: false, fieldCopy: copy, value: null });
  if (text.length > MAX_CHARS) return fail('badNumber');
  if (text === '' || text === '-' || text === '+' || text === '.' || text === ',') return fail('badNumber');
  if (/[.,]$/.test(text) || /^[.,]/.test(text)) return fail('badNumber');
  if (/e/i.test(text)) return fail('badNumber');
  if (thousandsSeparatorPresent(text)) return fail('thousands');
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(text);
  if (!match) return fail('badNumber');
  const negative = match[1] === '-';
  const intPart = match[2]!;
  const frac = match[3] ?? '';
  if (negative && !allowNegative) return fail('badNumber');
  if (negative && intPart.replace(/^0+/, '') === '' && frac.replace(/0+$/, '') === '') {
    return fail('badNumber'); // negative zero
  }
  const normalized =
    (negative ? '-' : '') + (intPart.replace(/^0+(?=\d)/, '') || '0') + (frac ? '.' + frac : '');
  return { ok: true, fieldCopy: 'badNumber', value: normalized };
}
