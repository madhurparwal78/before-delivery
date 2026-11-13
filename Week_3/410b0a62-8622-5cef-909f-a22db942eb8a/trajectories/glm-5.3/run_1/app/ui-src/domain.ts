// Shared domain rules for display. The server owns every computation; these
// helpers mirror the published display rules for rounding and step maths.

export const MIN_DURATION_S = 30;
export const MAX_DURATION_S = 14400;
export const DURATION_INCREMENT = 30;
export const MIN_TARGET = 30;
export const MAX_TARGET = 200;
export const MIN_REPEAT = 1;
export const MAX_REPEAT = 20;
export const MAX_STEPS = 50;

const HALF_TOLERANCE = 0.000000001;

export function roundHalfAwayFromZero(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const isHalf = Math.abs(diff - 0.5) <= HALF_TOLERANCE;
  const up = isHalf || diff > 0.5;
  if (!up) return floor / factor;
  if (scaled < 0) return floor / factor;
  return (floor + 1) / factor;
}

export function fmt(value: number, decimals: number): string {
  return roundHalfAwayFromZero(value, decimals).toFixed(decimals);
}

export function fmtTss(value: number): string {
  return fmt(value, 1);
}

/** Form: 1 decimal with a sign; zero prints exactly `0.0`. */
export function fmtForm(value: number): string {
  const rounded = roundHalfAwayFromZero(value, 1);
  if (rounded === 0) return '0.0';
  return rounded > 0 ? `+${rounded.toFixed(1)}` : `\u2212${Math.abs(rounded).toFixed(1)}`;
}

export function fmtIf(value: number): string {
  return fmt(value, 2);
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function fmtPace(secondsPerKm: number): string {
  const whole = Math.max(0, roundHalfAwayFromZero(secondsPerKm, 0));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

// --- steps ------------------------------------------------------------------

export type SimpleKind = 'warmup' | 'steady' | 'recovery' | 'cooldown';
export type StepKind = SimpleKind | 'interval';

export interface SimpleStep {
  kind: SimpleKind;
  duration_s: number;
  target_pct: number;
}

export interface IntervalPart {
  duration_s: number;
  target_pct: number;
}

export interface IntervalStep {
  kind: 'interval';
  repeat: number;
  work: IntervalPart;
  recovery: IntervalPart;
}

export type Step = SimpleStep | IntervalStep;

export const STEP_DEFAULTS: Record<StepKind, unknown> = {
  warmup: { duration_s: 600, target_pct: 60 },
  steady: { duration_s: 1200, target_pct: 75 },
  recovery: { duration_s: 300, target_pct: 50 },
  cooldown: { duration_s: 600, target_pct: 50 },
  interval: {
    repeat: 4,
    work: { duration_s: 180, target_pct: 105 },
    recovery: { duration_s: 180, target_pct: 55 },
  },
};

export const STEP_LABELS: Record<StepKind, string> = {
  warmup: 'Warm-up',
  steady: 'Steady',
  interval: 'Interval',
  recovery: 'Recovery',
  cooldown: 'Cool-down',
};

export type StepPartKind = 'work' | 'recovery' | '';

export interface StepPart {
  kind: StepPartKind;
  label: string;
  duration_s: number;
  target_pct: number;
}

export function stepParts(step: Step): StepPart[] {
  if (step.kind === 'interval') {
    return [
      { kind: 'work', label: 'Interval work', duration_s: step.work.duration_s, target_pct: step.work.target_pct },
      { kind: 'recovery', label: 'Interval recovery', duration_s: step.recovery.duration_s, target_pct: step.recovery.target_pct },
    ];
  }
  return [{ kind: '', label: STEP_LABELS[step.kind], duration_s: step.duration_s, target_pct: step.target_pct }];
}

export function stepDuration(step: Step): number {
  if (step.kind === 'interval') return step.repeat * (step.work.duration_s + step.recovery.duration_s);
  return step.duration_s;
}

export function stepsDuration(steps: readonly Step[]): number {
  return steps.reduce((sum, s) => sum + stepDuration(s), 0);
}

export function stepsPlannedTss(steps: readonly Step[]): number {
  let tss = 0;
  for (const step of steps) {
    if (step.kind === 'interval') {
      const work = step.work.duration_s * (step.work.target_pct / 100) ** 2;
      const rec = step.recovery.duration_s * (step.recovery.target_pct / 100) ** 2;
      tss += step.repeat * (work + rec);
    } else {
      tss += step.duration_s * (step.target_pct / 100) ** 2;
    }
  }
  return (tss / 3600) * 100;
}

export function plannedIf(steps: readonly Step[]): number {
  const tss = stepsPlannedTss(steps);
  const hours = stepsDuration(steps) / 3600;
  return Math.sqrt(tss / (hours * 100));
}

export const COMPLIANCE_LABELS: Record<string, string> = {
  'on-target': 'On target',
  close: 'Close',
  'off-target': 'Off target',
  missed: 'Missed',
  unplanned: 'Unplanned',
  planned: 'Planned',
};
