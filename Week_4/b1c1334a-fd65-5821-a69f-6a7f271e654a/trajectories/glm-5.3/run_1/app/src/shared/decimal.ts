import { COPY, invalid } from './errors.js';

/**
 * Exact decimal values. A Decimal is carried as its canonical string
 * (a plain `-?digits.dddd` with exactly 4 places), and all arithmetic runs
 * on digit strings via decimal.js, never through binary floating point.
 */

const ROUND_PLACES = 4;

export interface ParsedDecimal {
  text: string;
}

const DIGITS = /^[0-9]+$/;

/**
 * Parse a decimal from its exact text. Accepts `-?digits[.digits]` with at most
 * 15 digits before the point. Rejects exponents and any other shape.
 */
export function parseDecimalText(raw: string): string | null {
  let s = raw.trim();
  if (s === '') return null;
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    return null;
  }
  const point = s.indexOf('.');
  let intPart = s;
  let fracPart: string | null = null;
  if (point !== -1) {
    if (s.indexOf('.', point + 1) !== -1) return null;
    intPart = s.slice(0, point);
    fracPart = s.slice(point + 1);
  }
  if (intPart === '' && fracPart === null) return null;
  if (intPart !== '' && !DIGITS.test(intPart)) return null;
  if (intPart === '') intPart = '0';
  if (fracPart !== null && fracPart !== '') {
    if (!DIGITS.test(fracPart)) return null;
  }
  if (intPart.length > 15) return null;
  if (neg && /^0*\.?0*$/.test(s)) neg = false;
  return roundTo4((neg ? '-' : '') + intPart + (fracPart !== null ? '.' + fracPart : ''));
}

export function roundTo4(text: string): string {
  // text is a plain decimal string, possibly with more than 4 fraction digits.
  const neg = text.startsWith('-');
  const body = neg ? text.slice(1) : text;
  const [ip, fp = ''] = body.split('.');
  let frac = (fp + '0000').slice(0, 4);
  const rest = fp.slice(4);
  let carry = false;
  if (rest.length > 0 && rest[0] >= '5') {
    frac = addOne(frac) ?? '';
    carry = frac === '';
    if (carry) frac = '0000';
  }
  let intp = ip;
  if (carry) intp = addOneStr(intp);
  if (isZero(intp, frac)) return '0.0000';
  intp = intp.replace(/^0+(?=[0-9])/, '');
  return (neg ? '-' : '') + intp + '.' + frac;
}

function isZero(ip: string, fp: string): boolean {
  return /^0+$/.test(ip) && /^0+$/.test(fp);
}

function addOne(frac: string): string | null {
  const d = frac.split('');
  let i = d.length - 1;
  while (i >= 0) {
    if (d[i] === '9') {
      d[i] = '0';
      i--;
    } else {
      d[i] = String.fromCharCode(d[i].charCodeAt(0) + 1);
      return d.join('');
    }
  }
  return null; // carry
}

function addOneStr(ip: string): string {
  const d = ip.split('');
  let i = d.length - 1;
  while (i >= 0) {
    if (d[i] === '9') {
      d[i] = '0';
      i--;
    } else {
      d[i] = String.fromCharCode(d[i].charCodeAt(0) + 1);
      return d.join('');
    }
  }
  return '1' + d.join('');
}

export const ZERO = '0.0000';

export function isCanonicalDecimal(s: string): boolean {
  return /^-?[0-9]+\.[0-9]{4}$/.test(s);
}

/** Validate + canonicalise a decimal from request text/number. */
export function decimalFromInput(value: RawNumber | string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (/e/i.test(value)) return null;
    return parseDecimalText(value);
  }
  return parseDecimalText(value.raw);
}

/** A number literal from JSON, kept as its exact source text. */
export class RawNumber {
  readonly raw: string;
  constructor(raw: string) {
    this.raw = raw;
  }
  static of(raw: string) {
    return new RawNumber(raw);
  }
}

/**
 * JSON parser that keeps number literals as RawNumber so decimals never
 * pass through binary floating point. Throws on invalid JSON.
 */
export function parseJson(text: string): unknown {
  let pos = 0;
  const error = (msg: string): never => {
    throw new SyntaxError(`${msg} at position ${pos}`);
  };
  function skipWs() {
    while (pos < text.length) {
      const c = text[pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') pos++;
      else break;
    }
  }
  function parseValue(): unknown {
    skipWs();
    if (pos >= text.length) error('Unexpected end');
    const c = text[pos];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    if (c === '-') {
      if (isNumberStart(text[pos + 1])) return parseNumber();
      error('Unexpected character');
    }
    if (isNumberStart(c)) return parseNumber();
    if (text.startsWith('true', pos)) {
      pos += 4;
      return true;
    }
    if (text.startsWith('false', pos)) {
      pos += 5;
      return false;
    }
    if (text.startsWith('null', pos)) {
      pos += 4;
      return null;
    }
    return error('Unexpected character');
  }
  function isNumberStart(c: string | undefined): boolean {
    return c !== undefined && c >= '0' && c <= '9';
  }
  function parseNumber(): RawNumber {
    const start = pos;
    if (text[pos] === '-') pos++;
    while (pos < text.length && text[pos] >= '0' && text[pos] <= '9') pos++;
    if (text[pos] === '.') {
      pos++;
      while (pos < text.length && text[pos] >= '0' && text[pos] <= '9') pos++;
    }
    return new RawNumber(text.slice(start, pos));
  }
  function parseString(): string {
    pos++; // opening quote
    let out = '';
    while (pos < text.length) {
      const c = text[pos];
      if (c === '"') {
        pos++;
        return out;
      }
      if (c === '\\') {
        pos++;
        const e = text[pos];
        if (e === 'u') {
          const hex = text.slice(pos + 1, pos + 5);
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 5;
        } else {
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === 'b' ? '\b' : e === 'f' ? '\f' : e;
          pos++;
        }
      } else {
        out += c;
        pos++;
      }
    }
    return error('Unterminated string');
  }
  function parseArray(): unknown[] {
    pos++;
    const out: unknown[] = [];
    skipWs();
    if (text[pos] === ']') {
      pos++;
      return out;
    }
    for (;;) {
      out.push(parseValue());
      skipWs();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === ']') {
        pos++;
        return out;
      }
      error('Expected , or ]');
    }
  }
  function parseObject(): Record<string, unknown> {
    pos++;
    const out: Record<string, unknown> = {};
    skipWs();
    if (text[pos] === '}') {
      pos++;
      return out;
    }
    for (;;) {
      skipWs();
      if (text[pos] !== '"') error('Expected key');
      const key = parseString();
      skipWs();
      if (text[pos] !== ':') error('Expected :');
      pos++;
      out[key] = parseValue();
      skipWs();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === '}') {
        pos++;
        return out;
      }
      error('Expected , or }');
    }
  }
  const result = parseValue();
  skipWs();
  if (pos !== text.length) error('Trailing content');
  return result;
}

export function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string') throw invalid({ [field]: COPY.enterText });
  return v;
}
