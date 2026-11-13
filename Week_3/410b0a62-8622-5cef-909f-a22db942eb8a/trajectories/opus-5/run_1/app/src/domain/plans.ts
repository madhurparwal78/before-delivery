import { isIntervalStep, normaliseSteps, snapDuration, stepsDurationS } from './steps.js';
import { addDays } from './time.js';
import type { PlanEntry, Step } from './types.js';

export const REST_WEEK_FACTOR = 0.6;
export const PLAN_MIN_WEEKS = 1;
export const PLAN_MAX_WEEKS = 24;

export function planWeekOfDay(dayIndex: number): number {
  return Math.ceil(dayIndex / 7);
}

export function isRestWeek(weekIndex: number): boolean {
  return weekIndex % 4 === 0;
}

function scaleDuration(seconds: number): number {
  return Math.max(30, snapDuration(seconds * REST_WEEK_FACTOR));
}

function scaleStep(step: Step): Step {
  if (isIntervalStep(step)) {
    return {
      kind: 'interval',
      repeat: step.repeat,
      work: { duration_s: scaleDuration(step.work.duration_s), target_pct: step.work.target_pct },
      recovery: {
        duration_s: scaleDuration(step.recovery.duration_s),
        target_pct: step.recovery.target_pct,
      },
    };
  }
  return { kind: step.kind, duration_s: scaleDuration(step.duration_s), target_pct: step.target_pct };
}

/** Rest weeks scale every duration by 0.6, snapped to 30 seconds, minimum 0:00:30. */
export function applyRestWeek(entry: PlanEntry): PlanEntry {
  if (!isRestWeek(planWeekOfDay(entry.day))) return entry;
  const steps = entry.steps ? entry.steps.map(scaleStep) : null;
  return {
    ...entry,
    steps,
    duration_s: steps ? stepsDurationS(steps) : scaleDuration(entry.duration_s),
  };
}

/** Day 1 of the plan: the start date, or the event date minus the plan's length. */
export function planFirstDay(mode: 'start' | 'event', date: string, weeks: number): string {
  return mode === 'start' ? date : addDays(date, -(7 * weeks - 1));
}

export function planEntryDate(firstDay: string, dayIndex: number): string {
  return addDays(firstDay, dayIndex - 1);
}

/** A stored plan entry keeps its own duration, taken from its steps when it has them. */
export function normalisePlanEntry(entry: PlanEntry): PlanEntry {
  const steps = entry.steps ? normaliseSteps(entry.steps) : null;
  return {
    day: entry.day,
    start_local: entry.start_local,
    sport: entry.sport,
    title: entry.title,
    steps,
    duration_s: steps ? stepsDurationS(steps) : entry.duration_s,
  };
}
