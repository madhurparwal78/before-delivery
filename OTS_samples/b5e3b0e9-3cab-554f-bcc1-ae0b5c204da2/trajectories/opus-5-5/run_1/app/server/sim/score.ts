import { clockText } from '../../shared/time.js';
import type { Engine } from './engine.js';
import { PASS_MARK } from './model.js';

export interface BreakdownRow {
  simTime: string;
  rule: string;
  text: string;
  penalty: number;
}

export interface Debrief {
  score: number;
  passed: boolean;
  breakdown: BreakdownRow[];
  log: { simTime: string; position: string; kind: string; text: string }[];
}

/** The score, derived once from the finished log: violations, then slot delay. */
export function buildDebrief(engine: Engine): Debrief {
  const s = engine.state;
  const endTime = s.endTime ?? s.now;
  const violations: BreakdownRow[] = s.log
    .filter((row) => row.kind === 'alert' && row.rule && row.penalty !== null)
    .map((row) => ({ simTime: clockText(row.simTime), rule: row.rule!, text: row.text, penalty: row.penalty! }));
  const slots = engine.scenario.traffic
    .filter((item) => item.kind === 'dep' && item.slotSeconds !== null)
    .map((item) => {
      const takeoff = s.aircraft[item.callsign]?.takeoffStart ?? endTime;
      const wait = takeoff - (engine.startTime + item.slotSeconds! + engine.timers.slotToleranceSeconds);
      return { callsign: item.callsign, takeoff, minutes: Math.floor(wait / 60) };
    })
    .filter((slot) => slot.minutes >= 1)
    .sort((a, b) => a.takeoff - b.takeoff || (a.callsign < b.callsign ? -1 : 1))
    .map((slot) => ({
      simTime: clockText(slot.takeoff),
      rule: 'Slot',
      text: `Slot delay ${slot.callsign}: ${slot.minutes} min`,
      penalty: slot.minutes,
    }));
  const breakdown = [...violations, ...slots];
  const score = Math.max(0, 100 - breakdown.reduce((sum, row) => sum + row.penalty, 0));
  return {
    score,
    passed: score >= PASS_MARK,
    breakdown,
    log: s.log.map((row) => ({ simTime: clockText(row.simTime), position: row.position, kind: row.kind, text: row.text })),
  };
}
