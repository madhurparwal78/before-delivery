/**
 * The SLA engine. Elapsed business time, pause, stop, reopen, priority swap,
 * thresholds and breach are all decided here, from the record's state history.
 */

import {
  businessSecondsOver,
  instantAfterBusinessSeconds,
  intersectIntervals,
  isOpenAt,
  mergeIntervals,
  nextOpenChange,
  subtractIntervals,
  type BusinessSchedule,
  type Interval,
} from './schedule';

export interface SlaDefinition {
  readonly name: string;
  readonly table: string;
  readonly start: string;
  readonly pause: string;
  readonly stop: string;
  readonly schedule: string;
  readonly targets: Readonly<Record<string, number>>;
}

export type SlaStage = 'in_progress' | 'paused' | 'completed' | 'cancelled';

/** What is stored per attached SLA. Everything else is computed. */
export interface SlaInstanceRow {
  readonly id: number;
  readonly recordNumber: string;
  readonly definition: string;
  readonly priority: number;
  readonly startAt: number;
  readonly targetSeconds: number;
  readonly breached: boolean;
  readonly cancelled: boolean;
  readonly thresholdsSent: readonly number[];
}

export interface StateSegment {
  readonly state: string;
  readonly from: number;
  readonly to: number;
}

export interface SlaComputed {
  readonly id: number;
  readonly definition: string;
  readonly priority: number;
  readonly stage: SlaStage;
  readonly startAt: number;
  readonly targetSeconds: number;
  readonly elapsedSeconds: number;
  readonly remainingSeconds: number;
  readonly pausedSeconds: number;
  readonly percent: number;
  readonly breached: boolean;
  readonly ticking: boolean;
  readonly nextChangeAt: number | null;
}

/** Decides, per state segment, whether the clock was paused or stopped. */
export interface SegmentFlags {
  readonly paused: boolean;
  readonly stopped: boolean;
}

export type SegmentJudge = (state: string) => SegmentFlags;

export const thresholdPercents: readonly number[] = [50, 75, 100];

/**
 * Running time is start_at to now, less every interval in which the pause
 * condition held and every interval in which the stop condition held.
 */
export function computeSla(
  row: SlaInstanceRow,
  segments: readonly StateSegment[],
  judge: SegmentJudge,
  schedule: BusinessSchedule,
  now: number,
): SlaComputed {
  const window: Interval = { start: row.startAt, end: Math.max(row.startAt, now) };
  const pauseIntervals: Interval[] = [];
  const stopIntervals: Interval[] = [];
  for (const segment of segments) {
    const start = Math.max(segment.from, window.start);
    const end = Math.min(segment.to, window.end);
    if (end <= start) continue;
    const flags = judge(segment.state);
    if (flags.stopped) stopIntervals.push({ start, end });
    else if (flags.paused) pauseIntervals.push({ start, end });
  }
  const running = subtractIntervals([window], [...pauseIntervals, ...stopIntervals]);
  const elapsedSeconds = businessSecondsOver(schedule, running);
  const pausedSeconds = businessSecondsOver(
    schedule,
    intersectIntervals(mergeIntervals(pauseIntervals), subtractIntervals([window], stopIntervals)),
  );

  const current = segments.find((s) => now >= s.from && now < s.to) ?? segments[segments.length - 1];
  const currentFlags = current ? judge(current.state) : { paused: false, stopped: false };

  const stage: SlaStage = row.cancelled
    ? 'cancelled'
    : currentFlags.stopped
      ? 'completed'
      : currentFlags.paused
        ? 'paused'
        : 'in_progress';

  const breached = row.breached || elapsedSeconds >= row.targetSeconds;
  const ticking = stage === 'in_progress' && isOpenAt(schedule, now);
  const nextChangeAt = stage === 'in_progress' ? nextOpenChange(schedule, now) : null;

  return {
    id: row.id,
    definition: row.definition,
    priority: row.priority,
    stage,
    startAt: row.startAt,
    targetSeconds: row.targetSeconds,
    elapsedSeconds,
    remainingSeconds: row.targetSeconds - elapsedSeconds,
    pausedSeconds,
    percent: percentOf(elapsedSeconds, row.targetSeconds),
    breached,
    ticking,
    nextChangeAt,
  };
}

export function percentOf(elapsed: number, target: number): number {
  if (target <= 0) return 100;
  return Math.floor((elapsed * 100) / target);
}

export function thresholdSeconds(target: number, percent: number): number {
  return Math.ceil((target * percent) / 100);
}

/** Thresholds this SLA has reached but not yet acted on. */
export function reachedThresholds(row: SlaInstanceRow, elapsedSeconds: number): number[] {
  return thresholdPercents.filter(
    (p) => !row.thresholdsSent.includes(p) && elapsedSeconds >= thresholdSeconds(row.targetSeconds, p),
  );
}

/**
 * The instant the next unsent threshold would be reached if nothing else
 * happens, so the background engine can wake exactly then.
 */
export function nextThresholdAt(
  row: SlaInstanceRow,
  computed: SlaComputed,
  schedule: BusinessSchedule,
  now: number,
): number | null {
  if (computed.stage !== 'in_progress') return null;
  for (const percent of thresholdPercents) {
    if (row.thresholdsSent.includes(percent)) continue;
    const needed = thresholdSeconds(row.targetSeconds, percent) - computed.elapsedSeconds;
    if (needed <= 0) return now;
    return instantAfterBusinessSeconds(schedule, now, needed);
  }
  return null;
}

/**
 * The one SLA a row label, a card name or a record summary shows: among those
 * in progress or paused, the highest percent, ties by definition name.
 */
export function shownSla(slas: readonly SlaComputed[]): SlaComputed | null {
  const live = slas.filter((s) => s.stage === 'in_progress' || s.stage === 'paused');
  if (live.length === 0) return null;
  return live.reduce((best, candidate) => {
    if (candidate.percent !== best.percent) return candidate.percent > best.percent ? candidate : best;
    return candidate.definition < best.definition ? candidate : best;
  });
}

/** The published duration form `<H>:<MM>:<SS>`, hours unbounded. */
export function durationText(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** The published countdown copy used on forms, queue rows and the portal. */
export function countdownText(sla: SlaComputed, metInTime?: boolean): string {
  if (sla.stage === 'completed') return metInTime ?? !sla.breached ? 'Met' : 'Missed';
  if (sla.stage === 'paused') return `Paused at ${durationText(sla.remainingSeconds)} left`;
  if (sla.remainingSeconds < 0) return `Breached by ${durationText(-sla.remainingSeconds)}`;
  return `${durationText(sla.remainingSeconds)} left`;
}
