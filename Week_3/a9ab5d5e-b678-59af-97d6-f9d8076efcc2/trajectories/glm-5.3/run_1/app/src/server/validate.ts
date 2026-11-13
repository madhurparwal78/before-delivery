/** Field validation with the API's exact messages. Each helper either
 *  returns the parsed value or throws a 422 with the field's message. */
import { graphemeCount, hasForbiddenChars, nfc } from '../lib/text';
import { problem } from './problems';

export type Errs = Record<string, string>;

export class ValidationErrors extends Error {
  readonly errors: Errs;
  constructor(errors: Errs) {
    super('validation');
    this.errors = errors;
  }
}

export function fail(errors: Errs): never {
  throw new ValidationErrors(errors);
}

export function invalidMessage(): string {
  return 'This value is out of range.';
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function hasField(v: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(v, name);
}

/** Plain integer only: 1e3, 1000.0, -0, "1000" all fail. */
export function isPlainInt(v: unknown): boolean {
  if (typeof v !== 'number' || !Number.isInteger(v)) return false;
  if (Object.is(v, -0)) return false;
  return true;
}

export function checkText(
  field: string,
  v: unknown,
  opts: { min?: number; max?: number; allowLineFeed?: boolean },
): string {
  const { min = 1, max } = opts;
  if (typeof v !== 'string') fail({ [field]: 'This field is not accepted.' });
  const s = v as string;
  // hidden or control characters first
  const forbidden = forbiddenIn(s, opts.allowLineFeed ?? false);
  if (forbidden) fail({ [field]: 'Remove hidden or control characters.' });
  // length in graphemes
  const len = graphemeCount(nfc(s));
  if (min !== undefined || max !== undefined) {
    if (min !== undefined && max !== undefined) {
      if (len < min || len > max) fail({ [field]: `Use ${min} to ${max} characters.` });
    } else if (max !== undefined) {
      if (len > max) fail({ [field]: `Use at most ${max} characters.` });
    }
  }
  return s;
}

function forbiddenIn(s: string, allowLf: boolean): boolean {
  // LF allowed inside note/description/reason, never as final character
  const test = allowLf ? s.replace(/\n/g, '') : s;
  if (hasForbiddenChars(test)) return true;
  if (allowLf && s.endsWith('\n')) return true;
  return false;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function checkDate(field: string, v: unknown): string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) fail({ [field]: 'Enter a real date as YYYY-MM-DD.' });
  const [y, m, d] = v.split('-').map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1) fail({ [field]: 'Enter a real date as YYYY-MM-DD.' });
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) fail({ [field]: 'Enter a real date as YYYY-MM-DD.' });
  return v;
}

export function checkInterval(field: string, v: unknown): { first: string; last: string } {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(v)) {
    fail({ [field]: invalidMessage() });
  }
  const [a, b] = (v as string).split('/');
  checkDate(`${field}[0]`, a);
  checkDate(`${field}[1]`, b);
  if (a > b) fail({ [field]: invalidMessage() });
  return { first: a, last: b };
}

export function checkEmail(field: string, v: unknown): string {
  if (typeof v !== 'string') fail({ [field]: 'Enter a valid email address.' });
  const s = v as string;
  if (graphemeCount(nfc(s)) > 254) fail({ [field]: 'Use at most 254 characters.' });
  // RFC-lite email: local@domain, no spaces
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(s)) fail({ [field]: 'Enter a valid email address.' });
  return s;
}

export function checkEnum<T extends string>(field: string, v: unknown, values: readonly T[]): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    fail({ [field]: invalidMessage() });
  }
  return v as T;
}

export function checkId(_field: string, v: unknown): string {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) {
    throw problem(404, 'not_found');
  }
  return v;
}
