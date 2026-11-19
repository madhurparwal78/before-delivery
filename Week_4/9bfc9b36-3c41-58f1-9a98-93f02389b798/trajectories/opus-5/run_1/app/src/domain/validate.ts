import { FIELD_COPY, textLengthCopy, wholeNumberCopy } from '../shared/copy';
import { invalid, type FieldErrors } from '../http/errors';

/** The one place that checks member bounds and gathers their field copy. */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const EMAIL_PATTERN = /^[^@]+@[^@]+$/;

export const MEASURED_ON_FIRST = '2020-01-01';
export const MEASURED_ON_LAST = '2030-12-31';

export class Check {
  private readonly errors: FieldErrors = {};
  private readonly body: Readonly<Record<string, unknown>>;

  constructor(body: Readonly<Record<string, unknown>>) {
    this.body = body;
  }

  has(member: string): boolean {
    return this.body[member] !== undefined && this.body[member] !== null;
  }

  raw(member: string): unknown {
    return this.body[member];
  }

  fail(member: string, copy: string): void {
    if (this.errors[member] === undefined) this.errors[member] = copy;
  }

  text(member: string, min: number, max: number): string {
    const value = this.body[member];
    if (value === undefined || value === null) {
      if (min === 0) return '';
      this.fail(member, FIELD_COPY.required);
      return '';
    }
    if (typeof value !== 'string') {
      this.fail(member, textLengthCopy(min, max));
      return '';
    }
    const length = [...value].length;
    if (length < min || length > max) {
      this.fail(member, min === 0 && length === 0 ? FIELD_COPY.required : textLengthCopy(min, max));
      return value;
    }
    return value;
  }

  wholeNumber(member: string, min: number, max: number): number {
    const value = this.body[member];
    if (value === undefined || value === null) {
      this.fail(member, FIELD_COPY.required);
      return min;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.fail(member, wholeNumberCopy(min, max));
      return min;
    }
    return value;
  }

  /** A length in whole millimetres, with its own published copy. */
  lengthMm(member: string): number {
    const value = this.body[member];
    if (value === undefined || value === null) {
      this.fail(member, FIELD_COPY.required);
      return 0;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 60000) {
      this.fail(member, FIELD_COPY.lengthRange);
      return 0;
    }
    return value;
  }

  date(member: string): string {
    const value = this.body[member];
    if (value === undefined || value === null) {
      this.fail(member, FIELD_COPY.required);
      return MEASURED_ON_FIRST;
    }
    if (typeof value !== 'string' || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      this.fail(member, FIELD_COPY.badDate);
      return MEASURED_ON_FIRST;
    }
    if (value.slice(0, 10) !== new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10)) {
      this.fail(member, FIELD_COPY.badDate);
      return MEASURED_ON_FIRST;
    }
    if (value < MEASURED_ON_FIRST || value > MEASURED_ON_LAST) {
      this.fail(member, FIELD_COPY.badDate);
      return MEASURED_ON_FIRST;
    }
    return value;
  }

  /** An instant that must sit after the request instant. */
  futureInstant(member: string, now: Date): string | null {
    const value = this.body[member];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
      this.fail(member, FIELD_COPY.badInstant);
      return null;
    }
    const stamp = Date.parse(value);
    if (Number.isNaN(stamp) || stamp <= now.getTime()) {
      this.fail(member, FIELD_COPY.badInstant);
      return null;
    }
    return value;
  }

  requiredFutureInstant(member: string, now: Date): string {
    if (!this.has(member)) {
      this.fail(member, FIELD_COPY.required);
      return new Date(now.getTime() + 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    return this.futureInstant(member, now) ?? new Date(now.getTime() + 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  email(member: string): string {
    const value = this.body[member];
    if (value === undefined || value === null) {
      this.fail(member, FIELD_COPY.required);
      return '';
    }
    if (typeof value !== 'string' || [...value].length < 3 || [...value].length > 254 || !wellFormedEmail(value)) {
      this.fail(member, FIELD_COPY.email);
      return typeof value === 'string' ? value : '';
    }
    return value;
  }

  password(member: string): string {
    const value = this.body[member];
    if (value === undefined || value === null) {
      this.fail(member, FIELD_COPY.required);
      return '';
    }
    if (typeof value !== 'string' || [...value].length < 12 || [...value].length > 128) {
      this.fail(member, FIELD_COPY.password);
      return '';
    }
    return value;
  }

  lot(member: string): string {
    const value = this.body[member];
    if (value === undefined || value === null) {
      this.fail(member, FIELD_COPY.lot);
      return '';
    }
    if (typeof value !== 'string' || !wellFormedLot(value)) {
      this.fail(member, FIELD_COPY.lot);
      return '';
    }
    return value;
  }

  /** A reason of 1 to 200 characters, with its own published copy. */
  reason(member: string, copyWhenMissing: string): string {
    const value = this.body[member];
    if (value === undefined || value === null || value === '') {
      this.fail(member, copyWhenMissing);
      return '';
    }
    if (typeof value !== 'string') {
      this.fail(member, copyWhenMissing);
      return '';
    }
    if ([...value].length > 200) {
      this.fail(member, FIELD_COPY.reasonTooLong);
      return value;
    }
    return value;
  }

  amountPence(member: string): number {
    const value = this.body[member];
    if (value === undefined || value === null) {
      this.fail(member, FIELD_COPY.amount);
      return 0;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      this.fail(member, FIELD_COPY.amount);
      return 0;
    }
    return value;
  }

  choice<T extends string>(member: string, allowed: readonly T[], copy: string): T {
    const value = this.body[member];
    if (value === undefined || value === null) {
      this.fail(member, FIELD_COPY.required);
      return allowed[0] as T;
    }
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.fail(member, copy);
      return allowed[0] as T;
    }
    return value as T;
  }

  anyErrors(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  /** Refuses the request when any member failed its bound. */
  done(): void {
    if (this.anyErrors()) throw invalid(this.errors);
  }
}

export function wellFormedEmail(value: string): boolean {
  if (!EMAIL_PATTERN.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || value.indexOf('@', at + 1) !== -1) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

export function wellFormedLot(value: string): boolean {
  const points = [...value];
  if (points.length < 1 || points.length > 20) return false;
  return points.every((point) => {
    const code = point.codePointAt(0) as number;
    return code > 0x20 && code !== 0x7f;
  });
}

/** Emails are stored and compared after Unicode NFC normalisation and lower-casing. */
export function normaliseEmail(value: string): string {
  return value.normalize('NFC').toLowerCase();
}
