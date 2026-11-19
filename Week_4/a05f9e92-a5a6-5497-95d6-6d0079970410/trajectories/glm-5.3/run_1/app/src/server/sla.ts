// The SLA engine: one place computes every SLA number.
//
// An SLA instance attaches the first time its start condition is true on a
// save. Running time is start..now minus every pause interval and every stop
// interval, all from the state history. Elapsed business time counts only the
// schedule's open windows. Thresholds fire once; breach sticks.

import { Db, clock } from './db.js';
import { ScheduleRow, businessSeconds, isOpenAt, nextOpenChange, openWindowsForRange } from './schedule.js';
import { Ctx, parse, evaluate, truthy } from '../express/expression.js';

export type SlaStage = 'in_progress' | 'paused' | 'completed' | 'cancelled';

export interface SlaDefinitionRow {
  name: string;
  table: string;
  start: string;
  pause: string;
  stop: string;
  schedule: string;
  targets: Record<string, number>;
}

export interface SlaInstance {
  id: string;
  record: string;
  definition: string;
  priority: number;
  stage: SlaStage;
  start_at: number;
  target_seconds: number;
  elapsed_seconds: number;
  remaining_seconds: number;
  paused_seconds: number;
  percent: number;
  breached: boolean;
  ticking: boolean;
  next_change_at: number | null;
  server_time: number;
}

export interface SlaAction { event: 'threshold' | 'breach'; percent?: number; definition: string; record: string }

export interface SlaComputation {
  elapsed: number;
  paused: number;
  stage: SlaStage;
  breached: boolean;
  ticking: boolean;
  nextChange: number | null;
}

/** Evaluate an SLA condition expression against a record snapshot. */
export function slaCondition(text: string, rec: Record<string, unknown>, now: number): boolean {
  const ctx: Ctx = {
    rec,
    now,
    me: '',
    roles: new Set(),
    resolve: (path: string) => {
      let cur: unknown = rec;
      for (const part of path.split('.')) {
        if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[part];
        } else {
          return null;
        }
      }
      return cur;
    },
  };
  try {
    return truthy(evaluate(parse(text), ctx));
  } catch {
    return false;
  }
}

/** Pause and stop intervals from the record's state history. */
export interface Interval { from: number; to: number }

export function computeSla(params: {
  definition: SlaDefinitionRow;
  schedule: ScheduleRow;
  priority: number;
  startAt: number;
  history: Array<{ state: string; fields: Record<string, unknown>; at: number }>;
  now: number;
}): SlaComputation {
  const { definition, schedule, priority, startAt, history, now } = params;
  const target = definition.targets[String(priority)] ?? 0;

  // Build per-interval record snapshots from history, then evaluate pause/stop
  // over the whole span second by second is too slow; instead evaluate at each
  // window boundary and each history instant.
  const span = Math.min(now, Number.MAX_SAFE_INTEGER);
  if (span <= startAt) {
    return { elapsed: 0, paused: 0, stage: 'in_progress', breached: false, ticking: isOpenAt(schedule, now), nextChange: nextOpenChange(schedule, now) };
  }

  const snapAt = (t: number): Record<string, unknown> => {
    let cur: Record<string, unknown> = history[0]?.fields ?? {};
    for (const h of history) {
      if (h.at <= t) cur = { ...h.fields, state: h.state };
      else break;
    }
    return cur;
  };

  // Points where pause/stop truth may change: history instants and window edges.
  const edges = new Set<number>([startAt, now]);
  for (const h of history) edges.add(h.at);
  for (const [s, e] of openWindowsForRange(schedule, startAt, now)) {
    edges.add(s);
    edges.add(e);
  }
  const points = [...edges].filter(p => p >= startAt && p <= now).sort((a, b) => a - b);

  // The stop condition may be true for some intervals and false again after a
  // reopen; stopped intervals never count towards elapsed. Pause intervals are
  // subtracted from the running time and also tracked as paused_seconds.
  let pausedSecs = 0;
  let stopElapsed: number | null = null;
  let lastStopEnd: number | null = null;

  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i];
    const to = points[i + 1];
    const snap = snapAt(from);
    const stoppedNow = slaCondition(definition.stop, snap, from);
    if (stoppedNow) {
      // Record the elapsed accumulated at the moment of the first stop; a later
      // resume continues from the last stop's end.
      lastStopEnd = to;
      continue;
    }
    const pausedNow = slaCondition(definition.pause, snap, from);
    if (pausedNow) {
      pausedSecs += businessSeconds(schedule, from, to);
    }
  }

  // Elapsed: business time of running intervals minus pause business time.
  // Build the union of running intervals (where stop is false).
  const running: Array<[number, number]> = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i];
    const to = points[i + 1];
    const snap = snapAt(from);
    if (!slaCondition(definition.stop, snap, from)) {
      if (running.length && running[running.length - 1][1] === from) {
        running[running.length - 1][1] = to;
      } else {
        running.push([from, to]);
      }
    } else {
      lastStopEnd = to;
    }
  }

  let runningSeconds = 0;
  for (const [s, e] of running) runningSeconds += businessSeconds(schedule, s, e);

  // paused_seconds is the business time inside pause intervals that fall in
  // running time (stop false), matching "the business time that fell inside
  // pause intervals".
  let pauseSeconds = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i];
    const to = points[i + 1];
    const snap = snapAt(from);
    if (!slaCondition(definition.stop, snap, from) && slaCondition(definition.pause, snap, from)) {
      pauseSeconds += businessSeconds(schedule, from, to);
    }
  }
  const elapsed = Math.max(0, runningSeconds - pauseSeconds);

  // Stage: completed when the record is currently stopped; paused when the
  // pause condition holds right now; otherwise in progress.
  const nowSnap = snapAt(now);
  let stage: SlaStage = 'in_progress';
  if (slaCondition(definition.stop, nowSnap, now)) stage = 'completed';
  else if (slaCondition(definition.pause, nowSnap, now)) stage = 'paused';

  void lastStopEnd;
  void stopElapsed;

  const breached = target > 0 && elapsed >= target;
  const ticking = stage === 'in_progress' && isOpenAt(schedule, now);
  const nextChange = stage === 'in_progress' ? nextOpenChange(schedule, now) : null;

  return { elapsed, paused: pauseSeconds, stage, breached, ticking, nextChange };
}

/** Thresholds crossed between two elapsed values. */
export function thresholdsCrossed(before: number, after: number, target: number): number[] {
  const out: number[] = [];
  for (const pct of [50, 75, 100]) {
    const point = (target * pct) / 100;
    if (before < point && after >= point) out.push(pct);
  }
  return out;
}
