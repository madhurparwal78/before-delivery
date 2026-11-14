import { simClock } from "./clock.ts";
import { RULES, isPassed, scoreOf, slotDelayMinutes, slotDelayText, type RuleId, type Timers } from "./rules.ts";
import type { LogEntry, SessionSetup, SessionState } from "./state.ts";

interface BreakdownRow {
  simTime: string;
  rule: string;
  text: string;
  penalty: number;
}

interface Debriefed {
  score: number;
  passed: boolean;
  breakdown: BreakdownRow[];
}

/** The score, derived once from the log: 100 less each violation's penalty and each slot delay. */
export function debrief(setup: SessionSetup, state: SessionState, timers: Timers, log: LogEntry[]): Debriefed {
  const violations: BreakdownRow[] = log
    .filter((row) => row.kind === "alert" && row.rule !== undefined)
    .map((row) => ({ simTime: simClock(row.simTime), rule: row.rule ?? "", text: row.text, penalty: RULES[row.rule as RuleId].penalty }));
  const delays = state.aircraft
    .filter((aircraft) => aircraft.kind === "dep" && aircraft.slotSeconds !== null)
    .map((aircraft) => {
      const waited = aircraft.takeoffStart ?? state.simTime;
      const minutes = slotDelayMinutes(waited, setup.scenarioStart + (aircraft.slotSeconds ?? 0), timers.slotToleranceSeconds);
      return { callsign: aircraft.callsign, at: waited, minutes };
    })
    .filter((delay) => delay.minutes > 0)
    .sort((a, b) => a.at - b.at);
  const slots: BreakdownRow[] = delays.map((d) => ({
    simTime: simClock(d.at),
    rule: "Slot",
    text: slotDelayText(d.callsign, d.minutes),
    penalty: d.minutes,
  }));
  const breakdown = [...violations, ...slots];
  const score = scoreOf(breakdown.map((row) => row.penalty));
  return { score, passed: isPassed(score), breakdown };
}
