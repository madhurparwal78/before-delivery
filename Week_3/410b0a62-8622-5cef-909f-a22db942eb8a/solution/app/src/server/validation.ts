import { isValidDate, isValidWeek } from '../shared/dates.js';
import { LIMITS } from '../shared/steps.js';
import type { Step, ThresholdKind } from '../shared/types.js';

export const MESSAGES = {
  date: 'Enter a date as YYYY-MM-DD.',
  future: 'Completed sessions cannot be in the future.',
  beforeHistory: "This day is before the athlete's training history starts.",
  past: 'Pick today or a later day.',
  title: 'Enter a title of 1 to 80 characters.',
  startLocal: 'Enter a time as HH:MM.',
  sport: 'Choose bike or run.',
  noSteps: 'Add at least one step.',
  stepDuration: 'Each step needs a duration from 0:00:30 to 4:00:00 in 30-second steps.',
  stepTarget: 'Each target must be a whole percent from 30 to 200.',
  stepRepeat: 'Repeats must be from 1 to 20.',
  tooManySteps: 'A workout has at most 50 steps.',
  duration: 'Enter a duration from 0:01:00 to 24:00:00.',
  power: 'Enter an average power from 1 to 2000 W.',
  pace: 'Enter a pace from 2:00 to 20:00 per km.',
  ftp: 'Enter an FTP from 50 to 600 W.',
  thresholdPace: 'Enter a threshold pace from 2:30 to 15:00 per km.',
  coachCode: 'No coach uses that code.',
  comment: 'Write a comment of 1 to 1000 characters.',
  weeks: 'A plan runs 1 to 24 weeks.',
  eventName: 'Enter an event name of 1 to 60 characters.',
  mode: 'Choose start or event.',
  week: 'Enter a week as YYYY-Www.',
  workoutIds: 'Choose planned workouts from that week.'
} as const;

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max;

export const dateMessage = (value: unknown): string | null => (isValidDate(value) ? null : MESSAGES.date);
export const weekMessage = (value: unknown): string | null => (isValidWeek(value) ? null : MESSAGES.week);
export const titleMessage = (value: unknown): string | null => (isText(value, 1, 80) ? null : MESSAGES.title);
export const sportMessage = (value: unknown): string | null => (value === 'bike' || value === 'run' ? null : MESSAGES.sport);
export const startLocalMessage = (value: unknown): string | null =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? null : MESSAGES.startLocal;
export const durationMessage = (value: unknown): string | null => (isInt(value, 60, 86_400) ? null : MESSAGES.duration);
export const powerMessage = (value: unknown): string | null => (isInt(value, 1, 2000) ? null : MESSAGES.power);
export const paceMessage = (value: unknown): string | null => (isInt(value, 120, 1200) ? null : MESSAGES.pace);
export const commentMessage = (value: unknown): string | null => (isText(value, 1, 1000) ? null : MESSAGES.comment);
export const eventNameMessage = (value: unknown): string | null => (isText(value, 1, 60) ? null : MESSAGES.eventName);
export const weeksMessage = (value: unknown): string | null => (isInt(value, 1, 24) ? null : MESSAGES.weeks);

export function thresholdValueMessage(kind: ThresholdKind, value: unknown): string | null {
  return kind === 'ftp' ? (isInt(value, 50, 600) ? null : MESSAGES.ftp) : isInt(value, 150, 900) ? null : MESSAGES.thresholdPace;
}

export function completedDateMessage(date: string, today: string, seriesStart: string | null): string | null {
  if (date > today) return MESSAGES.future;
  return seriesStart !== null && date < seriesStart ? MESSAGES.beforeHistory : null;
}

export const plannedDateMessage = (date: string, today: string): string | null => (date < today ? MESSAGES.past : null);

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const goodDuration = (value: unknown): boolean => isInt(value, LIMITS.durationMin, LIMITS.durationMax) && (value as number) % LIMITS.durationStep === 0;
const goodTarget = (value: unknown): boolean => isInt(value, LIMITS.targetMin, LIMITS.targetMax);

const PLAIN_KINDS = ['warmup', 'steady', 'recovery', 'cooldown'];

function shapeOf(step: unknown): { durations: unknown[]; targets: unknown[]; repeat: unknown } | null {
  if (!record(step)) return null;
  if (step['kind'] === 'interval') {
    const { work, recovery } = step;
    if (!record(work) || !record(recovery)) return null;
    return { durations: [work['duration_s'], recovery['duration_s']], targets: [work['target_pct'], recovery['target_pct']], repeat: step['repeat'] };
  }
  if (!PLAIN_KINDS.includes(step['kind'] as string)) return null;
  return { durations: [step['duration_s']], targets: [step['target_pct']], repeat: 1 };
}

/** The first message that applies to a list of steps, or null when it is valid. */
export function stepsMessage(steps: unknown): string | null {
  if (!Array.isArray(steps) || steps.length === 0) return MESSAGES.noSteps;
  const shapes = steps.map(shapeOf);
  const valid = shapes.flatMap((shape) => (shape ? [shape] : []));
  if (valid.length !== shapes.length || valid.some((shape) => !shape.durations.every(goodDuration))) return MESSAGES.stepDuration;
  if (valid.some((shape) => !shape.targets.every(goodTarget))) return MESSAGES.stepTarget;
  if (valid.some((shape) => !isInt(shape.repeat, LIMITS.repeatMin, LIMITS.repeatMax))) return MESSAGES.stepRepeat;
  return steps.length > LIMITS.stepsMax ? MESSAGES.tooManySteps : null;
}

/** The steps of a request that passed `stepsMessage`, reduced to the published fields. */
export function cleanSteps(steps: unknown[]): Step[] {
  return (steps as Record<string, unknown>[]).map((step): Step => {
    if (step['kind'] === 'interval') {
      const work = step['work'] as Record<string, number>;
      const recovery = step['recovery'] as Record<string, number>;
      return {
        kind: 'interval',
        repeat: step['repeat'] as number,
        work: { duration_s: work['duration_s'] as number, target_pct: work['target_pct'] as number },
        recovery: { duration_s: recovery['duration_s'] as number, target_pct: recovery['target_pct'] as number }
      };
    }
    return { kind: step['kind'] as 'warmup', duration_s: step['duration_s'] as number, target_pct: step['target_pct'] as number };
  });
}
