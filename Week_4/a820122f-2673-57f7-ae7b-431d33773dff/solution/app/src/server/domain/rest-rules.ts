import { HALF_HOUR_MS } from './time.js';

const SLOT_MS = HALF_HOUR_MS;
const SHORT_BREAK_SLOTS = 2; // a rest run shorter than one hour is not rest

export type CellState = 'not_logged' | 'rest' | 'work' | 'short_break';
export type RuleSetName = 'standard' | 'flag_exception';
export type Verdict = 'pass' | 'breach' | 'incomplete';
export type RestRule =
  | 'rest_24h'
  | 'rest_periods'
  | 'six_hour_block'
  | 'fourteen_hour_gap'
  | 'rest_168h'
  | 'three_period_days';

const NOT_LOGGED = 0;
const REST = 1;
const WORK = 2;

type TimelineEntry = {
  startMs: number;
  endMs: number;
  kind: 'rest' | 'work';
  late: boolean;
};

export type RestPeriod = {
  startSlot: number;
  endSlot: number;
  lengthSlots: number;
  qualifies: boolean;
};

/** A crew member's half-hour cells on the elapsed timeline, with the rest periods derived once. */
export type Timeline = {
  baseMs: number;
  slotCount: number;
  raw: Uint8Array;
  late: Uint8Array;
  periodOfSlot: Int32Array;
  periods: RestPeriod[];
  restPrefix: Int32Array;
  notLoggedPrefix: Int32Array;
  periodStartPrefix: Int32Array;
};

export function buildTimeline(entries: TimelineEntry[], fromMs: number, toMs: number): Timeline {
  const baseMs = fromMs;
  const slotCount = Math.max(0, Math.round((toMs - fromMs) / SLOT_MS));
  const raw = new Uint8Array(slotCount);
  const late = new Uint8Array(slotCount);
  for (const entry of entries) {
    const first = Math.max(0, Math.ceil((entry.startMs - baseMs) / SLOT_MS));
    const last = Math.min(slotCount, Math.floor((entry.endMs - baseMs) / SLOT_MS));
    for (let slot = first; slot < last; slot += 1) {
      raw[slot] = entry.kind === 'rest' ? REST : WORK;
      late[slot] = entry.late ? 1 : 0;
    }
  }

  const periods: RestPeriod[] = [];
  const periodOfSlot = new Int32Array(slotCount).fill(-1);
  let slot = 0;
  while (slot < slotCount) {
    if (raw[slot] !== REST) {
      slot += 1;
      continue;
    }
    let end = slot;
    while (end < slotCount && raw[end] === REST) end += 1;
    const lengthSlots = end - slot;
    const period: RestPeriod = {
      startSlot: slot,
      endSlot: end,
      lengthSlots,
      qualifies: lengthSlots >= SHORT_BREAK_SLOTS,
    };
    const index = periods.length;
    periods.push(period);
    for (let i = slot; i < end; i += 1) periodOfSlot[i] = index;
    slot = end;
  }

  const restPrefix = new Int32Array(slotCount + 1);
  const notLoggedPrefix = new Int32Array(slotCount + 1);
  const periodStartPrefix = new Int32Array(slotCount + 1);
  for (let i = 0; i < slotCount; i += 1) {
    const periodIndex = periodOfSlot[i] as number;
    const period = periodIndex >= 0 ? (periods[periodIndex] as RestPeriod) : null;
    const isRest = period !== null && period.qualifies;
    restPrefix[i + 1] = (restPrefix[i] as number) + (isRest ? 1 : 0);
    notLoggedPrefix[i + 1] = (notLoggedPrefix[i] as number) + (raw[i] === NOT_LOGGED ? 1 : 0);
    const startsHere = period !== null && period.qualifies && period.startSlot === i;
    periodStartPrefix[i + 1] = (periodStartPrefix[i] as number) + (startsHere ? 1 : 0);
  }

  return {
    baseMs,
    slotCount,
    raw,
    late,
    periodOfSlot,
    periods,
    restPrefix,
    notLoggedPrefix,
    periodStartPrefix,
  };
}

export function slotOf(timeline: Timeline, ms: number): number {
  return Math.round((ms - timeline.baseMs) / SLOT_MS);
}

export function cellStateAt(timeline: Timeline, slot: number): CellState {
  if (slot < 0 || slot >= timeline.slotCount) return 'not_logged';
  const value = timeline.raw[slot];
  if (value === WORK) return 'work';
  if (value !== REST) return 'not_logged';
  const periodIndex = timeline.periodOfSlot[slot] as number;
  const period = timeline.periods[periodIndex] as RestPeriod;
  return period.qualifies ? 'rest' : 'short_break';
}

export function cellIsLate(timeline: Timeline, slot: number): boolean {
  if (slot < 0 || slot >= timeline.slotCount) return false;
  return timeline.late[slot] === 1;
}

type RuleLimits = {
  restHours24: number;
  restPeriods: number;
  restHours168: number;
  threePeriodDays: boolean;
};

function limitsFor(ruleSet: RuleSetName): RuleLimits {
  return ruleSet === 'flag_exception'
    ? { restHours24: 10, restPeriods: 3, restHours168: 70, threePeriodDays: true }
    : { restHours24: 10, restPeriods: 2, restHours168: 77, threePeriodDays: false };
}

type WindowJudgement = {
  restHours: number;
  verdict: Verdict;
  rulesFailed: RestRule[];
};

const RULE_ORDER_24: RestRule[] = [
  'rest_24h',
  'rest_periods',
  'six_hour_block',
  'fourteen_hour_gap',
  'three_period_days',
];

function periodStartsBetween(timeline: Timeline, fromSlot: number, toSlot: number): number {
  const from = Math.max(0, Math.min(timeline.slotCount, fromSlot));
  const to = Math.max(0, Math.min(timeline.slotCount, toSlot));
  if (to <= from) return 0;
  return (timeline.periodStartPrefix[to] as number) - (timeline.periodStartPrefix[from] as number);
}

function longestNonRestRunSlots(timeline: Timeline, fromSlot: number, toSlot: number): number {
  let longest = 0;
  let run = 0;
  for (let slot = fromSlot; slot < toSlot; slot += 1) {
    const state = cellStateAt(timeline, slot);
    if (state === 'rest') {
      run = 0;
    } else {
      run += 1;
      if (run > longest) longest = run;
    }
  }
  return longest;
}

function hasSixHourBlock(timeline: Timeline, fromSlot: number, toSlot: number): boolean {
  for (const period of timeline.periods) {
    if (!period.qualifies || period.lengthSlots < 12) continue;
    if (period.startSlot < toSlot && period.endSlot > fromSlot) return true;
  }
  return false;
}

/** Judges one rolling window of elapsed time under the rule set in force at its end. */
export function judgeWindow(
  timeline: Timeline,
  startMs: number,
  hours: 24 | 168,
  ruleSet: RuleSetName,
): WindowJudgement {
  const fromSlot = slotOf(timeline, startMs);
  const toSlot = fromSlot + hours * 2;
  const limits = limitsFor(ruleSet);
  const clampedFrom = Math.max(0, fromSlot);
  const clampedTo = Math.min(timeline.slotCount, toSlot);
  const restSlots =
    clampedTo > clampedFrom
      ? (timeline.restPrefix[clampedTo] as number) - (timeline.restPrefix[clampedFrom] as number)
      : 0;
  const restHours = restSlots / 2;
  const outside = Math.max(0, clampedFrom - fromSlot) + Math.max(0, toSlot - clampedTo);
  const notLogged =
    outside > 0 ||
    (clampedTo > clampedFrom &&
      (timeline.notLoggedPrefix[clampedTo] as number) -
        (timeline.notLoggedPrefix[clampedFrom] as number) >
        0);
  if (notLogged) return { restHours, verdict: 'incomplete', rulesFailed: [] };

  const failed = new Set<RestRule>();
  if (hours === 24) {
    if (restHours < limits.restHours24) failed.add('rest_24h');
    const periodStarts = periodStartsBetween(timeline, fromSlot, toSlot);
    if (periodStarts > limits.restPeriods) failed.add('rest_periods');
    if (!hasSixHourBlock(timeline, fromSlot, toSlot)) failed.add('six_hour_block');
    if (longestNonRestRunSlots(timeline, fromSlot, toSlot) > 28) failed.add('fourteen_hour_gap');
    if (limits.threePeriodDays && periodStarts === 3) {
      let blocksWithThree = 0;
      for (let block = 0; block < 7; block += 1) {
        const blockTo = toSlot - 48 * block;
        const blockFrom = blockTo - 48;
        if (periodStartsBetween(timeline, blockFrom, blockTo) === 3) blocksWithThree += 1;
      }
      if (blocksWithThree > 2) failed.add('three_period_days');
    }
  } else if (restHours < limits.restHours168) {
    failed.add('rest_168h');
  }

  const rulesFailed =
    hours === 24 ? RULE_ORDER_24.filter((rule) => failed.has(rule)) : [...failed];
  return {
    restHours,
    verdict: rulesFailed.length > 0 ? 'breach' : 'pass',
    rulesFailed,
  };
}
