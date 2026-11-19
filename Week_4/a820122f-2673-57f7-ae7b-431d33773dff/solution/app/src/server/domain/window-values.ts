import { HOUR_MS, MINUTE_MS, formatInstant, formatShipTime } from './time.js';
import {
  clockChangeKind,
  clockChangeLabel,
  offsetAt,
  offsetJustBefore,
  type ClockChange,
  type VesselClock,
} from './ship-time.js';
import { judgeWindow, type RestRule, type RuleSetName, type Timeline, type Verdict } from './rest-rules.js';
import { ruleSetAt, type RuleSetPeriod } from './rule-sets.js';
import { positionAt, type PositionFix } from './position.js';

export type FoldState = 'flat' | 'gap' | 'crease' | 'gap_and_crease';

export type RestWindow = {
  start_utc: string;
  end_utc: string;
  hours: 24 | 168;
  start_ship_time: string;
  end_ship_time: string;
  rest_hours: number;
  verdict: Verdict;
  rules_failed: RestRule[];
  rule_set: RuleSetName;
  longitude: number | null;
  latitude: number | null;
  fold_state: FoldState;
  clock_face_hours: number;
  clock_change_labels: string[];
};

function coveredClockChanges(
  clock: VesselClock,
  startMs: number,
  endMs: number,
): ClockChange[] {
  return clock.changes
    .filter((change) => startMs < change.changesAtMs && change.changesAtMs < endMs)
    .sort((a, b) => a.changesAtMs - b.changesAtMs);
}

function foldStateFor(changes: ClockChange[]): FoldState {
  const hasRetard = changes.some((change) => clockChangeKind(change) === 'retard');
  const hasAdvance = changes.some((change) => clockChangeKind(change) === 'advance');
  if (hasRetard && hasAdvance) return 'gap_and_crease';
  if (hasRetard) return 'gap';
  if (hasAdvance) return 'crease';
  return 'flat';
}

type WindowInputs = {
  clock: VesselClock;
  fixes: PositionFix[];
  ruleSets: RuleSetPeriod[];
  timeline: Timeline;
};

/** Computes every published value of one rolling window. */
export function computeWindow(inputs: WindowInputs, startMs: number, hours: 24 | 168): RestWindow {
  const endMs = startMs + hours * HOUR_MS;
  const ruleSet = ruleSetAt(inputs.ruleSets, endMs);
  const judgement = judgeWindow(inputs.timeline, startMs, hours, ruleSet);
  const covered = coveredClockChanges(inputs.clock, startMs, endMs);
  const startOffset = offsetAt(inputs.clock, startMs);
  const endOffset = offsetJustBefore(inputs.clock, endMs);
  const position = positionAt(inputs.fixes, endMs);
  return {
    start_utc: formatInstant(startMs),
    end_utc: formatInstant(endMs),
    hours,
    start_ship_time: formatShipTime(startMs + startOffset * MINUTE_MS),
    end_ship_time: formatShipTime(endMs + endOffset * MINUTE_MS),
    rest_hours: judgement.restHours,
    verdict: judgement.verdict,
    rules_failed: judgement.rulesFailed,
    rule_set: ruleSet,
    longitude: position === null ? null : position.longitude,
    latitude: position === null ? null : position.latitude,
    fold_state: foldStateFor(covered),
    clock_face_hours: hours + (endOffset - startOffset) / 60,
    clock_change_labels: covered.map((change) => clockChangeLabel(change)),
  };
}

