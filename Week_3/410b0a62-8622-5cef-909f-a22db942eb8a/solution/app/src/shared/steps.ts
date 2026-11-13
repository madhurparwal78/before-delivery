import type { IntervalStep, PlainStep, PlainStepKind, Step } from './types.js';

export const LIMITS = {
  durationStep: 30,
  durationMin: 30,
  durationMax: 14_400,
  targetMin: 30,
  targetMax: 200,
  repeatMin: 1,
  repeatMax: 20,
  stepsMax: 50
} as const;

export type StepKind = Step['kind'];
export type PartName = 'work' | 'recovery' | null;

export interface Part {
  stepIndex: number;
  part: PartName;
  kind: StepKind;
  duration_s: number;
  target_pct: number;
  repeat: number | null;
}

export const STEP_LABELS: Record<StepKind, string> = {
  warmup: 'Warm-up',
  steady: 'Steady',
  interval: 'Interval',
  recovery: 'Recovery',
  cooldown: 'Cool-down'
};

export function partLabel(part: Pick<Part, 'kind' | 'part'>): string {
  if (part.kind !== 'interval') return STEP_LABELS[part.kind];
  return part.part === 'recovery' ? 'Interval recovery' : 'Interval work';
}

const PLAIN_DEFAULTS: Record<PlainStepKind, { duration_s: number; target_pct: number }> = {
  warmup: { duration_s: 600, target_pct: 60 },
  steady: { duration_s: 1200, target_pct: 75 },
  recovery: { duration_s: 300, target_pct: 50 },
  cooldown: { duration_s: 600, target_pct: 50 }
};

export function defaultStep(kind: StepKind): Step {
  if (kind === 'interval') {
    return {
      kind,
      repeat: 4,
      work: { duration_s: 180, target_pct: 105 },
      recovery: { duration_s: 180, target_pct: 55 }
    };
  }
  return { kind, ...PLAIN_DEFAULTS[kind] };
}

function stepParts(step: Step, stepIndex: number): Part[] {
  if (step.kind === 'interval') {
    return [
      { stepIndex, part: 'work', kind: 'interval', ...step.work, repeat: step.repeat },
      { stepIndex, part: 'recovery', kind: 'interval', ...step.recovery, repeat: step.repeat }
    ];
  }
  return [{ stepIndex, part: null, kind: step.kind, duration_s: step.duration_s, target_pct: step.target_pct, repeat: null }];
}

export const flattenParts = (steps: Step[]): Part[] => steps.flatMap((step, index) => stepParts(step, index));

function stepSeconds(step: Step): number {
  return step.kind === 'interval' ? step.repeat * (step.work.duration_s + step.recovery.duration_s) : step.duration_s;
}

function stepStress(step: Step): number {
  if (step.kind === 'interval') {
    const work = step.work.duration_s * (step.work.target_pct / 100) ** 2;
    const recovery = step.recovery.duration_s * (step.recovery.target_pct / 100) ** 2;
    return (step.repeat * (work + recovery)) / 3600 * 100;
  }
  return (step.duration_s * (step.target_pct / 100) ** 2) / 3600 * 100;
}

export const stepsDuration = (steps: Step[]): number => steps.reduce((sum, step) => sum + stepSeconds(step), 0);
export const stepsTss = (steps: Step[]): number => steps.reduce((sum, step) => sum + stepStress(step), 0);

export function stepsIf(steps: Step[]): number {
  const hours = stepsDuration(steps) / 3600;
  return hours === 0 ? 0 : Math.sqrt(stepsTss(steps) / (hours * 100));
}

export function withPart(step: Step, part: PartName, change: { duration_s?: number; target_pct?: number }): Step {
  if (step.kind === 'interval') {
    const key = part === 'recovery' ? 'recovery' : 'work';
    return { ...step, [key]: { ...step[key], ...change } } satisfies IntervalStep;
  }
  return { ...step, ...change } satisfies PlainStep;
}

export const snapDuration = (seconds: number): number =>
  Math.min(Math.max(Math.floor(seconds / LIMITS.durationStep + 0.5) * LIMITS.durationStep, LIMITS.durationMin), LIMITS.durationMax);

export const clampRepeat = (repeat: number): number => Math.min(Math.max(repeat, LIMITS.repeatMin), LIMITS.repeatMax);

export const snapTarget = (percent: number): number => {
  const rounded = percent < 0 ? -Math.floor(-percent + 0.5) : Math.floor(percent + 0.5);
  return Math.min(Math.max(rounded, LIMITS.targetMin), LIMITS.targetMax);
};
