import type { Overrides, WeekDay } from '../shared/types.js';
import { WEEK_DAYS, minutesFromHhMm } from '../shared/zone.js';
import { errors, fieldMessages } from './errors.js';

export type Json = Record<string, unknown>;

export function asObject(body: unknown): Json {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Json) : {};
}

/** Collects field messages so one 422 can carry every problem it found. */
export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw errors.validation(this.fields);
  }
}

export function requireString(body: Json, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value : '';
}

export function readReason(body: Json, field = 'reason'): string {
  const value = requireString(body, field).trim();
  if (value.length < 10 || value.length > 500) {
    throw errors.validation({ [field]: fieldMessages.reason });
  }
  return value;
}

export function readComment(body: Json): string | null {
  const raw = body.comment;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || raw.length > 500) {
    throw errors.validation({ comment: fieldMessages.comment });
  }
  return raw;
}

const PARAMETER_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;

export function readParameters(value: unknown, into: FieldErrors, field: string): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    into.add(field, fieldMessages.parameters);
    return {};
  }
  const parameters: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Json)) {
    if (!PARAMETER_KEY.test(key) || typeof raw !== 'string' || raw.length > 1000) {
      into.add(field, fieldMessages.parameters);
      return {};
    }
    parameters[key] = raw;
  }
  return parameters;
}

export function readReplicas(value: unknown, into: FieldErrors, field: string): Record<string, number> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    into.add(field, fieldMessages.replicas);
    return {};
  }
  const replicas: Record<string, number> = {};
  for (const [ref, raw] of Object.entries(value as Json)) {
    if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > 100) {
      into.add(field, fieldMessages.replicas);
      return {};
    }
    replicas[ref] = raw as number;
  }
  return replicas;
}

export function readOverrides(value: unknown, into: FieldErrors): Overrides {
  const source = asObject(value);
  return {
    parameters: readParameters(source.parameters, into, 'parameters'),
    replicas: readReplicas(source.replicas, into, 'replicas'),
  };
}

export function readWeekDays(value: unknown, into: FieldErrors): WeekDay[] {
  if (!Array.isArray(value) || value.length === 0) {
    into.add('days', fieldMessages.days);
    return [];
  }
  const days: WeekDay[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !WEEK_DAYS.includes(raw as WeekDay)) {
      into.add('days', fieldMessages.days);
      return [];
    }
    if (!days.includes(raw as WeekDay)) days.push(raw as WeekDay);
  }
  return WEEK_DAYS.filter((day) => days.includes(day));
}

export function readWindowTime(
  value: unknown,
  field: 'start' | 'end',
  into: FieldErrors,
): number | null {
  if (typeof value !== 'string') {
    into.add(field, fieldMessages.time);
    return null;
  }
  const minutes = minutesFromHhMm(value);
  const lowest = field === 'start' ? 0 : 1;
  const highest = field === 'start' ? 23 * 60 + 59 : 24 * 60;
  if (minutes === null || minutes < lowest || minutes > highest) {
    into.add(field, fieldMessages.time);
    return null;
  }
  return minutes;
}

export function readInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  // An instant must carry a zone, so a bare local time is not accepted.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) return null;
  return parsed;
}

export function readWholeNumber(value: string | null, low: number, high: number): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= low && parsed <= high ? parsed : null;
}
