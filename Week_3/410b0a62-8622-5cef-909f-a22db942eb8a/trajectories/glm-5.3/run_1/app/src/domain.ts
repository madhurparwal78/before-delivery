import type { LocalDate } from './dates.js';

// ---------------------------------------------------------------------------
// Display rounding: half away from zero, with a tolerance of 1e-9.
// ---------------------------------------------------------------------------

const HALF_TOLERANCE = 0.000000001;

export function roundHalfAwayFromZero(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  // Exactly halfway (within 1e-9) rounds away from zero; otherwise ties resolve upward.
  const isHalf = Math.abs(diff - 0.5) <= HALF_TOLERANCE;
  const up = isHalf || diff > 0.5;
  if (!up) return floor / factor;
  if (scaled < 0) return floor / factor;
  return (floor + 1) / factor;
}

/** Rounds a value to a whole number of decimals and returns the string form. */
export function fmt(value: number, decimals: number): string {
  return roundHalfAwayFromZero(value, decimals).toFixed(decimals);
}

export function fmtTss(value: number): string {
  return fmt(value, 1);
}

/** Form: 1 decimal with a sign; zero after rounding prints exactly `0.0`. */
export function fmtForm(value: number): string {
  const rounded = roundHalfAwayFromZero(value, 1);
  if (rounded === 0) return '0.0';
  return rounded > 0 ? `+${rounded.toFixed(1)}` : `\u2212${Math.abs(rounded).toFixed(1)}`;
}

export function fmtIf(value: number): string {
  return fmt(value, 2);
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Pace in seconds per km printed as `M:SS /km`, rounded to whole seconds. */
export function fmtPace(secondsPerKm: number): string {
  const whole = roundHalfAwayFromZero(secondsPerKm, 0);
  const secs = Math.max(0, whole);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

export function dataAttr(value: number, decimals: number): string {
  const rounded = roundHalfAwayFromZero(value, decimals);
  return (rounded === 0 ? 0 : rounded).toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

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

export const MIN_DURATION_S = 30;
export const MAX_DURATION_S = 14400;
export const DURATION_INCREMENT = 30;
export const MIN_TARGET = 30;
export const MAX_TARGET = 200;
export const MIN_REPEAT = 1;
export const MAX_REPEAT = 20;
export const MAX_STEPS = 50;

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

/** Flat parts for graphing and the Steps list; interval work/recovery pairs each count once. */
export function stepParts(step: Step): StepPart[] {
  if (step.kind === 'interval') {
    return [
      { kind: 'work', label: 'Interval work', duration_s: step.work.duration_s, target_pct: step.work.target_pct },
      { kind: 'recovery', label: 'Interval recovery', duration_s: step.recovery.duration_s, target_pct: step.recovery.target_pct },
    ];
  }
  const label = STEP_LABELS[step.kind];
  return [{ kind: '', label, duration_s: step.duration_s, target_pct: step.target_pct }];
}

// ---------------------------------------------------------------------------
// Stress scoring
// ---------------------------------------------------------------------------

/** Trailing 30-sample mean raised to the 4th power, averaged, 4th root. */
export function normalisedFourthRoot(values: readonly number[]): number {
  if (values.length === 0) return 0;
  if (values.length < 30) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return mean;
  }
  let running = 0;
  let sum4 = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    running += values[i] ?? 0;
    if (i >= 30) running -= values[i - 30] ?? 0;
    if (i >= 29) {
      const mean = running / 30;
      sum4 += mean ** 4;
      count++;
    }
  }
  return Math.pow(sum4 / count, 1 / 4);
}

export interface RideScore {
  np_w: number;
  if: number;
  tss: number;
}

export function scoreRide(powerSamples: readonly number[], ftp: number): RideScore {
  const np = normalisedFourthRoot(powerSamples);
  const intensity = np / ftp;
  const tss = (powerSamples.length * np * intensity) / (ftp * 3600) * 100;
  return { np_w: np, if: intensity, tss };
}

export interface RunScore {
  ns_mps: number;
  if: number;
  tss: number;
}

export function scoreRun(speedSamples: readonly number[], thresholdPaceSPerKm: number): RunScore {
  const ns = normalisedFourthRoot(speedSamples);
  const thresholdSpeed = 1000 / thresholdPaceSPerKm;
  const intensity = ns / thresholdSpeed;
  const tss = (speedSamples.length / 3600) * intensity ** 2 * 100;
  return { ns_mps: ns, if: intensity, tss };
}

export interface ManualScore {
  if: number;
  tss: number;
}

export function scoreManualBike(durationS: number, avgPowerW: number, ftp: number): ManualScore {
  const intensity = avgPowerW / ftp;
  const tss = (durationS / 3600) * intensity ** 2 * 100;
  return { if: intensity, tss };
}

export function scoreManualRun(durationS: number, avgPaceSPerKm: number, thresholdPaceSPerKm: number): ManualScore {
  const intensity = thresholdPaceSPerKm / avgPaceSPerKm;
  const tss = (durationS / 3600) * intensity ** 2 * 100;
  return { if: intensity, tss };
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export type ThresholdKind = 'ftp' | 'pace';

export interface ThresholdEntry {
  kind: ThresholdKind;
  value: number;
  effective_from: LocalDate;
}

export const FTP_RANGE = { min: 50, max: 600 };
export const PACE_RANGE = { min: 150, max: 900 };

export function thresholdInForce(entries: readonly ThresholdEntry[], kind: ThresholdKind, date: LocalDate): number | null {
  let best: ThresholdEntry | null = null;
  for (const e of entries) {
    if (e.kind !== kind) continue;
    if (e.effective_from > date) continue;
    if (!best || e.effective_from >= best.effective_from) best = e;
  }
  return best?.value ?? null;
}

export const SPORT_OF_THRESHOLD: Record<ThresholdKind, 'bike' | 'run'> = { ftp: 'bike', pace: 'run' };

// ---------------------------------------------------------------------------
// Daily series
// ---------------------------------------------------------------------------

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

export interface SeriesDay {
  date: LocalDate;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface SeriesStart {
  ctl: number;
  atl: number;
}

/**
 * CTL/ ATL recurrence from series_start. Form on day d uses yesterday's values.
 */
export function computeSeries(
  start: LocalDate,
  end: LocalDate,
  startValues: SeriesStart,
  dailyTss: ReadonlyMap<LocalDate, number>
): SeriesDay[] {
  const days: SeriesDay[] = [];
  const count = Math.max(0, Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000)) + 1;
  let ctl = startValues.ctl;
  let atl = startValues.atl;
  let prevCtl = ctl;
  let prevAtl = atl;
  for (let i = 0; i < count; i++) {
    const date = addDaysLocal(start, i);
    const tss = dailyTss.get(date) ?? 0;
    ctl = ctl + (tss - ctl) / CTL_DAYS;
    atl = atl + (tss - atl) / ATL_DAYS;
    const tsb = prevCtl - prevAtl;
    days.push({ date, tss, ctl, atl, tsb });
    prevCtl = ctl;
    prevAtl = atl;
  }
  return days;
}

function addDaysLocal(date: LocalDate, days: number): LocalDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export type ComplianceState = 'on-target' | 'close' | 'off-target' | 'missed' | 'unplanned' | 'planned';

export const COMPLIANCE_ORDER: readonly ComplianceState[] = [
  'on-target',
  'close',
  'off-target',
  'missed',
  'unplanned',
  'planned',
];

export const COMPLIANCE_LABELS: Record<ComplianceState, string> = {
  'on-target': 'On target',
  close: 'Close',
  'off-target': 'Off target',
  missed: 'Missed',
  unplanned: 'Unplanned',
  planned: 'Planned',
};

export function stateFromRatio(r: number): ComplianceState {
  if (r >= 0.8 && r <= 1.2) return 'on-target';
  if ((r >= 0.5 && r < 0.8) || (r > 1.2 && r <= 1.5)) return 'close';
  return 'off-target';
}

export type Tally = Record<ComplianceState, number>;

export function emptyTally(): Tally {
  return { 'on-target': 0, close: 0, 'off-target': 0, missed: 0, unplanned: 0, planned: 0 };
}
