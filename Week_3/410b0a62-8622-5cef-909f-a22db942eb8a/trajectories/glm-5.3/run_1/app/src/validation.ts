import type { LocalDate } from './dates.js';
import { isHhMm, isLocalDate } from './dates.js';
import { ValidationError } from './errors.js';
import {
  MAX_DURATION_S,
  MAX_REPEAT,
  MAX_STEPS,
  MAX_TARGET,
  MIN_DURATION_S,
  MIN_REPEAT,
  MIN_TARGET,
  type IntervalPart,
  type IntervalStep,
  type SimpleStep,
  type Step,
} from './domain.js';
import type { Sport } from './types.js';

export const MESSAGES = {
  date: 'Enter a date as YYYY-MM-DD.',
  dateFuture: 'Completed sessions cannot be in the future.',
  dateBeforeStart: "This day is before the athlete's training history starts.",
  datePlannedPast: 'Pick today or a later day.',
  title: 'Enter a title of 1 to 80 characters.',
  name: 'Enter a title of 1 to 80 characters.',
  startLocal: 'Enter a time as HH:MM.',
  sport: 'Choose bike or run.',
  stepsEmpty: 'Add at least one step.',
  stepsDuration: 'Each step needs a duration from 0:00:30 to 4:00:00 in 30-second steps.',
  stepsTarget: 'Each target must be a whole percent from 30 to 200.',
  stepsRepeat: 'Repeats must be from 1 to 20.',
  stepsTooMany: 'A workout has at most 50 steps.',
  duration: 'Enter a duration from 0:01:00 to 24:00:00.',
  avgPower: 'Enter an average power from 1 to 2000 W.',
  avgPace: 'Enter a pace from 2:00 to 20:00 per km.',
  ftpValue: 'Enter an FTP from 50 to 600 W.',
  paceValue: 'Enter a threshold pace from 2:30 to 15:00 per km.',
  coachCode: 'No coach uses that code.',
  body: 'Write a comment of 1 to 1000 characters.',
  weeks: 'A plan runs 1 to 24 weeks.',
  eventName: 'Enter an event name of 1 to 60 characters.',
  mode: 'Choose start or event.',
  week: 'Enter a week as YYYY-Www.',
  workoutIds: 'Choose planned workouts from that week.',
} as const;

export class FieldErrors {
  private errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  throwIfAny(): void {
    if (Object.keys(this.errors).length > 0) throw new ValidationError(this.errors);
  }

  get empty(): boolean {
    return Object.keys(this.errors).length === 0;
  }
}

// ---------------------------------------------------------------------------
// Primitive parsers
// ---------------------------------------------------------------------------

export function parseDate(value: unknown, field: string, errors: FieldErrors): LocalDate | null {
  if (typeof value !== 'string' || !isLocalDate(value)) {
    errors.add(field, MESSAGES.date);
    return null;
  }
  return value;
}

export function parseTitle(value: unknown, field: string, errors: FieldErrors): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80) {
    errors.add(field, field === 'name' ? MESSAGES.name : MESSAGES.title);
    return null;
  }
  return value;
}

export function parseStartLocal(value: unknown, errors: FieldErrors): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isHhMm(value)) {
    errors.add('start_local', MESSAGES.startLocal);
    return null;
  }
  return value;
}

export function parseSport(value: unknown, errors: FieldErrors): Sport | null {
  if (value !== 'bike' && value !== 'run') {
    errors.add('sport', MESSAGES.sport);
    return null;
  }
  return value;
}

export function parseDurationSeconds(value: unknown, errors: FieldErrors): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 60 || value > 86400) {
    errors.add('duration_s', MESSAGES.duration);
    return null;
  }
  return value;
}

function parsePart(raw: unknown, errors: FieldErrors, path: string): IntervalPart | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const duration = r.duration_s;
  const target = r.target_pct;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < MIN_DURATION_S || duration > MAX_DURATION_S || duration % 30 !== 0) {
    errors.add(path, MESSAGES.stepsDuration);
    return null;
  }
  if (typeof target !== 'number' || !Number.isInteger(target) || target < MIN_TARGET || target > MAX_TARGET) {
    errors.add(path, MESSAGES.stepsTarget);
    return null;
  }
  return { duration_s: duration, target_pct: target };
}

/** Validates and normalises a steps array against the published limits. */
export function parseSteps(value: unknown, errors: FieldErrors, field = 'steps'): Step[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    errors.add(field, MESSAGES.stepsEmpty);
    return null;
  }
  if (value.length > MAX_STEPS) {
    errors.add(field, MESSAGES.stepsTooMany);
    return null;
  }
  const out: Step[] = [];
  let anyInvalid = false;
  for (const raw of value) {
    const step = parseStep(raw, errors, field);
    if (step === null) {
      anyInvalid = true;
      continue;
    }
    out.push(step);
  }
  return anyInvalid ? null : out;
}

function parseStep(raw: unknown, errors: FieldErrors, field: string): Step | null {
  if (typeof raw !== 'object' || raw === null) {
    errors.add(field, MESSAGES.stepsDuration);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (kind === 'interval') {
    const repeat = r.repeat;
    if (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < MIN_REPEAT || repeat > MAX_REPEAT) {
      errors.add(field, MESSAGES.stepsRepeat);
      return null;
    }
    const work = parsePart(r.work, errors, field);
    const recovery = parsePart(r.recovery, errors, field);
    if (!work || !recovery) return null;
    const step: IntervalStep = { kind: 'interval', repeat, work, recovery };
    return step;
  }
  if (kind === 'warmup' || kind === 'steady' || kind === 'recovery' || kind === 'cooldown') {
    const part = parsePart(r, errors, field);
    if (!part) return null;
    const step: SimpleStep = { kind, duration_s: part.duration_s, target_pct: part.target_pct };
    return step;
  }
  errors.add(field, MESSAGES.stepsTarget);
  return null;
}

export function parseFtp(value: unknown, errors: FieldErrors): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 50 || value > 600) {
    errors.add('value', MESSAGES.ftpValue);
    return null;
  }
  return value;
}

export function parsePace(value: unknown, errors: FieldErrors): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 150 || value > 900) {
    errors.add('value', MESSAGES.paceValue);
    return null;
  }
  return value;
}
