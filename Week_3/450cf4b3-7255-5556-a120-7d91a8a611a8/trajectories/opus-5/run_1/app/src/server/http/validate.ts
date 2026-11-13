import { serverMessage } from '../../shared/copy';
import { isCalendarDate, isHalfHourHhmm, minutesOfHhmm } from '../../shared/format';
import { closingMinutes, openingMinutes } from '../kitchen-time';
import { validationFailed } from './errors';
import type { Ctx } from './route';

export function unacceptedFields(
  present: ReadonlyArray<string>,
  accepted: ReadonlyArray<string>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const name of present) {
    if (!accepted.includes(name)) fields[name] = serverMessage.unacceptedField;
  }
  return fields;
}

/** One 422 naming every failing field, unaccepted fields included. */
export function finishValidation(ctx: Ctx, fields: Record<string, string>): void {
  const merged = { ...ctx.unaccepted, ...fields };
  if (Object.keys(merged).length > 0) throw validationFailed(merged);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim());
}

export interface SpanQuery {
  date: string;
  from: string | null;
  to: string | null;
}

/** Shared query reading for the floor's date and optional span. */
export function readSpanQuery(ctx: Ctx): SpanQuery {
  const fields: Record<string, string> = {};
  const date = ctx.query.get('date');
  const from = ctx.query.get('from');
  const to = ctx.query.get('to');

  if (date === null || date === '') fields.date = serverMessage.dateRequired;
  else if (!isCalendarDate(date)) fields.date = serverMessage.badDate;

  const givenCount = [from, to].filter((value) => value !== null && value !== '').length;
  if (givenCount === 1) {
    fields.from = serverMessage.badSpan;
  } else if (givenCount === 2 && from !== null && to !== null) {
    const valid =
      isHalfHourHhmm(from) &&
      isHalfHourHhmm(to) &&
      minutesOfHhmm(from) >= openingMinutes &&
      minutesOfHhmm(to) <= closingMinutes &&
      minutesOfHhmm(from) < minutesOfHhmm(to);
    if (!valid) fields.from = serverMessage.badSpan;
  }

  finishValidation(ctx, fields);
  return {
    date: date ?? '',
    from: givenCount === 2 ? from : null,
    to: givenCount === 2 ? to : null,
  };
}

export function readDateQuery(ctx: Ctx, required: boolean, fallback: string): string {
  const date = ctx.query.get('date');
  const fields: Record<string, string> = {};
  if (date === null || date === '') {
    if (required) fields.date = serverMessage.dateRequired;
    finishValidation(ctx, fields);
    return fallback;
  }
  if (!isCalendarDate(date)) fields.date = serverMessage.badDate;
  finishValidation(ctx, fields);
  return date;
}
