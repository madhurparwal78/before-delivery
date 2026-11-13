import { ApiError, failField } from '../errors';
import { Ctx, cleanText } from '../http/context';
import { Json, isPlainIntegerLiteral } from '../lib/json';
import { HolidayDate, ParentRole, PlanRule, VersionBody } from '../domain/plan';
import { PlainDate, daysInMonth, epochDay, isValidDate, formatInstant, isOnTheMinute, isValidZone, localDate, parseInstant } from '../domain/time';

const OUT_OF_RANGE = 'This value is out of range.';

function object(value: Json | undefined, path: string, allowed: readonly string[]): Record<string, Json> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) failField(path, OUT_OF_RANGE);
  const record = value as Record<string, Json>;
  const errors = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) errors[path === '' ? key : `${path}.${key}`] = 'This field is not accepted.';
  }
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  return record;
}

function integer(ctx: Ctx, value: Json | undefined, path: string, min: number, max: number, message: string): number {
  if (typeof value !== 'number' || !isPlainIntegerLiteral(ctx.literal(path))) failField(path, message);
  if (value < min || value > max) failField(path, message);
  return value;
}

function text(value: Json | undefined, path: string, message: string, min: number, max: number): string {
  if (typeof value !== 'string') failField(path, message);
  return cleanText(path, value, message, { min, max });
}

function date(value: Json | undefined, path: string): PlainDate {
  if (typeof value !== 'string' || !isValidDate(value)) failField(path, 'Enter a real date as YYYY-MM-DD.');
  return value;
}

function role(value: Json | undefined, path: string): ParentRole {
  if (value !== 'planning' && value !== 'other') failField(path, OUT_OF_RANGE);
  return value;
}

function nightInterval(value: Json | undefined, path: string, minNights: number, maxNights: number): string {
  if (typeof value !== 'string') failField(path, OUT_OF_RANGE);
  const parts = value.split('/');
  if (parts.length !== 2) failField(path, OUT_OF_RANGE);
  const [start, end] = parts as [string, string];
  if (!isValidDate(start) || !isValidDate(end)) failField(path, OUT_OF_RANGE);
  const nights = epochDay(end) - epochDay(start);
  if (nights < minNights || nights > maxNights) failField(path, OUT_OF_RANGE);
  return value;
}

function exchangeInstant(
  value: Json | undefined,
  path: string,
  zone: string,
  expectedDate: PlainDate,
): string {
  if (typeof value !== 'string') {
    failField(path, 'Enter an RFC 3339 instant with an offset and no fractional seconds.');
  }
  const instant = parseInstant(value);
  if (instant === null) failField(path, 'Enter an RFC 3339 instant with an offset and no fractional seconds.');
  if (!isOnTheMinute(instant)) failField(path, 'The exchange must be on the minute.');
  if (localDate(zone, instant) !== expectedDate) {
    failField(path, 'The first exchange must fall on the effective date.');
  }
  return formatInstant(zone, instant);
}

const holidayFields = ['id', 'kind', 'name', 'date', 'startOffset', 'nights', 'oddYears', 'evenYears'] as const;
const schoolBreakFields = ['id', 'kind', 'name', 'nights', 'split', 'firstHalfOddYears'] as const;
const vacationFields = ['id', 'kind', 'name', 'parent', 'nights', 'exchangeZone', 'firstExchangeAt'] as const;

function holidayDate(ctx: Ctx, value: Json | undefined, path: string): HolidayDate {
  const raw = object(value, path, ['type', 'month', 'day', 'weekday', 'n']);
  const type = raw.type;
  if (type === 'fixed') {
    object(value, path, ['type', 'month', 'day']);
    const month = integer(ctx, raw.month, `${path}.month`, 1, 12, OUT_OF_RANGE);
    const day = integer(ctx, raw.day, `${path}.day`, 1, 31, OUT_OF_RANGE);
    if (day > daysInMonth(2001, month)) failField(`${path}.day`, 'Enter a date that exists every year.');
    return { type: 'fixed', month, day };
  }
  if (type === 'nth_weekday') {
    object(value, path, ['type', 'month', 'weekday', 'n']);
    const month = integer(ctx, raw.month, `${path}.month`, 1, 12, OUT_OF_RANGE);
    const weekday = integer(ctx, raw.weekday, `${path}.weekday`, 1, 7, OUT_OF_RANGE);
    const n = integer(ctx, raw.n, `${path}.n`, -1, 5, OUT_OF_RANGE);
    if (n === 0) failField(`${path}.n`, OUT_OF_RANGE);
    return { type: 'nth_weekday', month, weekday, n };
  }
  if (type === 'easter') {
    object(value, path, ['type']);
    return { type: 'easter' };
  }
  return failField(`${path}.type`, OUT_OF_RANGE);
}

function planRule(ctx: Ctx, value: Json | undefined, index: number): PlanRule {
  const path = `rules[${index}]`;
  const raw = object(value, path, [...holidayFields, ...schoolBreakFields, ...vacationFields]);
  const kind = raw.kind;
  if (kind !== 'holiday' && kind !== 'school_break' && kind !== 'vacation') failField(`${path}.kind`, OUT_OF_RANGE);
  const id = text(raw.id, `${path}.id`, 'Each rule needs its own name.', 1, 40);
  if (!/^[a-z0-9-]{1,40}$/.test(id) || id === 'base') failField(`${path}.id`, 'Each rule needs its own name.');
  const name = text(raw.name, `${path}.name`, 'Use 1 to 80 characters.', 1, 80);
  if (kind === 'holiday') {
    object(value, path, holidayFields);
    return {
      id,
      kind,
      name,
      date: holidayDate(ctx, raw.date, `${path}.date`),
      startOffset: integer(ctx, raw.startOffset, `${path}.startOffset`, -7, 7, OUT_OF_RANGE),
      nights: integer(ctx, raw.nights, `${path}.nights`, 1, 14, OUT_OF_RANGE),
      oddYears: role(raw.oddYears, `${path}.oddYears`),
      evenYears: role(raw.evenYears, `${path}.evenYears`),
    };
  }
  if (kind === 'school_break') {
    object(value, path, schoolBreakFields);
    const split = raw.split;
    if (split !== 'halves' && split !== 'whole') failField(`${path}.split`, OUT_OF_RANGE);
    return {
      id,
      kind,
      name,
      nights: nightInterval(raw.nights, `${path}.nights`, 1, 120),
      split,
      firstHalfOddYears: role(raw.firstHalfOddYears, `${path}.firstHalfOddYears`),
    };
  }
  object(value, path, vacationFields);
  const nights = nightInterval(raw.nights, `${path}.nights`, 1, 42);
  const parent = role(raw.parent, `${path}.parent`);
  if (raw.exchangeZone === undefined && raw.firstExchangeAt === undefined) return { id, kind, name, parent, nights };
  const zone = raw.exchangeZone;
  if (typeof zone !== 'string' || !isValidZone(zone)) {
    failField(`${path}.exchangeZone`, 'Choose a time zone from the list.');
  }
  const firstNight = nights.split('/')[0] as PlainDate;
  return {
    id,
    kind,
    name,
    parent,
    nights,
    exchangeZone: zone,
    firstExchangeAt: exchangeInstant(raw.firstExchangeAt, `${path}.firstExchangeAt`, zone, firstNight),
  };
}

export function readVersionBody(ctx: Ctx): VersionBody {
  const body = ctx.body;
  const effectiveFrom = date(body.effectiveFrom, 'effectiveFrom');
  const zone = body.exchangeZone;
  if (typeof zone !== 'string' || !isValidZone(zone)) failField('exchangeZone', 'Choose a time zone from the list.');
  const firstExchangeAt = exchangeInstant(body.firstExchangeAt, 'firstExchangeAt', zone, effectiveFrom);
  const base = object(body.base, 'base', ['pattern', 'anchor']);
  const pattern = base.pattern;
  if (typeof pattern !== 'string' || !/^[PO]{1,28}$/.test(pattern)) {
    failField('base.pattern', 'Use 1 to 28 letters P and O.');
  }
  const anchor = date(base.anchor, 'base.anchor');
  const splitRaw = object(body.splitBp, 'splitBp', ['planning', 'other']);
  const planning = integer(ctx, splitRaw.planning, 'splitBp.planning', 0, 10000, 'The two shares must add up to 100%.');
  const other = integer(ctx, splitRaw.other, 'splitBp.other', 0, 10000, 'The two shares must add up to 100%.');
  if (planning + other !== 10000) failField('splitBp', 'The two shares must add up to 100%.');
  let maxConsecutiveNights: number | null = null;
  if (body.maxConsecutiveNights !== null && body.maxConsecutiveNights !== undefined) {
    maxConsecutiveNights = integer(ctx, body.maxConsecutiveNights, 'maxConsecutiveNights', 2, 60, 'Use 2 to 60 nights.');
  }
  const rulesRaw = body.rules;
  if (!Array.isArray(rulesRaw)) failField('rules', OUT_OF_RANGE);
  if (rulesRaw.length > 60) failField('rules', OUT_OF_RANGE);
  const rules = rulesRaw.map((rule, index) => planRule(ctx, rule, index));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  rules.forEach((rule, index) => {
    if (seenIds.has(rule.id) || seenNames.has(rule.name)) {
      failField(`rules[${index}].id`, 'Each rule needs its own name.');
    }
    seenIds.add(rule.id);
    seenNames.add(rule.name);
  });
  return {
    effectiveFrom,
    exchangeZone: zone,
    firstExchangeAt,
    base: { pattern, anchor },
    splitBp: { planning, other },
    maxConsecutiveNights,
    rules,
  };
}
