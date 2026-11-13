import type { IntervalStep, SimpleStep, SimpleStepKind, Step } from './types.js';

export const DURATION_STEP_S = 30;
export const DURATION_MIN_S = 30;
export const DURATION_MAX_S = 14_400;
export const TARGET_MIN_PCT = 30;
export const TARGET_MAX_PCT = 200;
export const REPEAT_MIN = 1;
export const REPEAT_MAX = 20;
export const MAX_STEPS = 50;

export type StepKind = SimpleStepKind | 'interval';
export type PartName = 'work' | 'recovery' | '';

export const STEP_LABELS: Record<StepKind, string> = {
  warmup: 'Warm-up',
  steady: 'Steady',
  interval: 'Interval',
  recovery: 'Recovery',
  cooldown: 'Cool-down',
};

export const PART_LABELS: Record<string, string> = {
  warmup: 'Warm-up',
  steady: 'Steady',
  'interval:work': 'Interval work',
  'interval:recovery': 'Interval recovery',
  recovery: 'Recovery',
  cooldown: 'Cool-down',
};

export function defaultStep(kind: StepKind): Step {
  switch (kind) {
    case 'warmup':
      return { kind: 'warmup', duration_s: 600, target_pct: 60 };
    case 'steady':
      return { kind: 'steady', duration_s: 1200, target_pct: 75 };
    case 'interval':
      return {
        kind: 'interval',
        repeat: 4,
        work: { duration_s: 180, target_pct: 105 },
        recovery: { duration_s: 180, target_pct: 55 },
      };
    case 'recovery':
      return { kind: 'recovery', duration_s: 300, target_pct: 50 };
    case 'cooldown':
      return { kind: 'cooldown', duration_s: 600, target_pct: 50 };
  }
}

export function isIntervalStep(step: Step): step is IntervalStep {
  return step.kind === 'interval';
}

export function stepDurationS(step: Step): number {
  return isIntervalStep(step)
    ? step.repeat * (step.work.duration_s + step.recovery.duration_s)
    : step.duration_s;
}

export function stepsDurationS(steps: Step[]): number {
  return steps.reduce((total, step) => total + stepDurationS(step), 0);
}

function stressSeconds(step: Step): number {
  if (isIntervalStep(step)) {
    const perRepeat =
      step.work.duration_s * (step.work.target_pct / 100) ** 2 +
      step.recovery.duration_s * (step.recovery.target_pct / 100) ** 2;
    return step.repeat * perRepeat;
  }
  return step.duration_s * (step.target_pct / 100) ** 2;
}

export function plannedTss(steps: Step[]): number {
  return (steps.reduce((total, step) => total + stressSeconds(step), 0) / 3600) * 100;
}

export function plannedIf(steps: Step[]): number {
  const hours = stepsDurationS(steps) / 3600;
  return Math.sqrt(plannedTss(steps) / (hours * 100));
}

export function snapDuration(seconds: number): number {
  const snapped = Math.floor(seconds / DURATION_STEP_S + 0.5) * DURATION_STEP_S;
  return Math.min(DURATION_MAX_S, Math.max(DURATION_MIN_S, snapped));
}

export function snapTarget(percent: number): number {
  const sign = percent < 0 ? -1 : 1;
  const rounded = sign * Math.floor(Math.abs(percent) + 0.5);
  return Math.min(TARGET_MAX_PCT, Math.max(TARGET_MIN_PCT, rounded));
}

export function clampDuration(seconds: number): number {
  return Math.min(DURATION_MAX_S, Math.max(DURATION_MIN_S, seconds));
}

export function clampRepeat(repeat: number): number {
  return Math.min(REPEAT_MAX, Math.max(REPEAT_MIN, repeat));
}

const SIMPLE_KINDS: SimpleStepKind[] = ['warmup', 'steady', 'recovery', 'cooldown'];

function validDuration(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= DURATION_MIN_S &&
    value <= DURATION_MAX_S &&
    value % DURATION_STEP_S === 0
  );
}

function validTarget(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= TARGET_MIN_PCT &&
    value <= TARGET_MAX_PCT
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The single steps validation: returns the first applicable message, or null. */
export function validateSteps(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return 'Add at least one step.';
  const steps = value as unknown[];
  const durationsOk = steps.every((step) => {
    if (!isRecord(step)) return false;
    if (step.kind === 'interval') {
      return (
        isRecord(step.work) &&
        isRecord(step.recovery) &&
        validDuration(step.work.duration_s) &&
        validDuration(step.recovery.duration_s)
      );
    }
    return SIMPLE_KINDS.includes(step.kind as SimpleStepKind) && validDuration(step.duration_s);
  });
  if (!durationsOk) return 'Each step needs a duration from 0:00:30 to 4:00:00 in 30-second steps.';
  const targetsOk = steps.every((step) => {
    if (!isRecord(step)) return false;
    if (step.kind === 'interval') {
      return (
        isRecord(step.work) &&
        isRecord(step.recovery) &&
        validTarget(step.work.target_pct) &&
        validTarget(step.recovery.target_pct)
      );
    }
    return validTarget(step.target_pct);
  });
  if (!targetsOk) return 'Each target must be a whole percent from 30 to 200.';
  const repeatsOk = steps.every((step) => {
    if (!isRecord(step) || step.kind !== 'interval') return true;
    return (
      typeof step.repeat === 'number' &&
      Number.isInteger(step.repeat) &&
      step.repeat >= REPEAT_MIN &&
      step.repeat <= REPEAT_MAX
    );
  });
  if (!repeatsOk) return 'Repeats must be from 1 to 20.';
  if (steps.length > MAX_STEPS) return 'A workout has at most 50 steps.';
  return null;
}

export function normaliseSteps(value: unknown): Step[] {
  const steps = value as (SimpleStep | IntervalStep)[];
  return steps.map((step) =>
    step.kind === 'interval'
      ? {
          kind: 'interval',
          repeat: step.repeat,
          work: { duration_s: step.work.duration_s, target_pct: step.work.target_pct },
          recovery: {
            duration_s: step.recovery.duration_s,
            target_pct: step.recovery.target_pct,
          },
        }
      : { kind: step.kind, duration_s: step.duration_s, target_pct: step.target_pct },
  );
}

export interface StepPart {
  stepIndex: number;
  kind: StepKind;
  part: PartName;
  duration_s: number;
  target_pct: number;
  repeat: number | null;
  label: string;
}

/** One entry per editable part: simple steps give one, interval steps give work and recovery. */
export function stepParts(steps: Step[]): StepPart[] {
  const parts: StepPart[] = [];
  steps.forEach((step, stepIndex) => {
    if (isIntervalStep(step)) {
      parts.push({
        stepIndex,
        kind: 'interval',
        part: 'work',
        duration_s: step.work.duration_s,
        target_pct: step.work.target_pct,
        repeat: step.repeat,
        label: PART_LABELS['interval:work'] as string,
      });
      parts.push({
        stepIndex,
        kind: 'interval',
        part: 'recovery',
        duration_s: step.recovery.duration_s,
        target_pct: step.recovery.target_pct,
        repeat: step.repeat,
        label: PART_LABELS['interval:recovery'] as string,
      });
      return;
    }
    parts.push({
      stepIndex,
      kind: step.kind,
      part: '',
      duration_s: step.duration_s,
      target_pct: step.target_pct,
      repeat: null,
      label: PART_LABELS[step.kind] as string,
    });
  });
  return parts;
}

/** Target watts (bike) or seconds per km (run) for a step target against a threshold. */
export function targetWatts(ftp: number, targetPct: number): number {
  return (ftp * targetPct) / 100;
}

export function targetPaceSecondsPerKm(thresholdPaceS: number, targetPct: number): number {
  return (thresholdPaceS * 100) / targetPct;
}
