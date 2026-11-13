import type { RuleName } from "./db.js";

export type { RuleName };

const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

/** A rest period is a maximal unbroken run of rest cells on the whole timeline. */
export interface RestPeriod {
  startMs: number;
  endMs: number;
  /** True when the run is shorter than one hour, so it is not rest in any total or rule. */
  shortBreak: boolean;
}

export type RuleSetKind = "standard" | "flag_exception";

/** One of the half-hour cells the timeline is sampled into. */
export interface CellSample {
  startMs: number;
  state: "rest" | "work" | "not_logged";
}

/** Build maximal runs from a half-hour cell sequence covering the whole elapsed timeline. */
export function restPeriodsFromCells(cells: CellSample[]): RestPeriod[] {
  const periods: RestPeriod[] = [];
  let runStart: number | null = null;
  let runIsRest: boolean | null = null;
  for (const cell of cells) {
    const isRest = cell.state === "rest";
    if (runStart === null || runIsRest !== isRest) {
      if (runStart !== null && runIsRest === true) {
        periods.push(finishPeriod(runStart, cell.startMs));
      }
      runStart = cell.startMs;
      runIsRest = isRest;
    }
  }
  if (runStart !== null && runIsRest === true && cells.length > 0) {
    const last = cells[cells.length - 1]!;
    periods.push(finishPeriod(runStart, last.startMs + HALF_HOUR_MS));
  }
  return periods;
}

function finishPeriod(startMs: number, endMs: number): RestPeriod {
  return { startMs, endMs, shortBreak: endMs - startMs < HOUR_MS };
}

export interface WindowJudgement {
  failedRules: RuleName[];
  restHours: number;
  ruleSet: RuleSetKind;
}

/** Judge a 24-hour or 168-hour window on elapsed time under the rules in force.
 *  `cells` must extend at least one hour either side of the window so that rest
 *  runs crossing an edge keep their true length: a run is short only when it is
 *  short on the whole timeline, never because the window clipped it. */
export function judgeWindow(
  cells: CellSample[],
  windowStartMs: number,
  hours: 24 | 168,
  ruleSet: RuleSetKind
): WindowJudgement {
  const periods = restPeriodsFromCells(cells);
  const windowEndMs = windowStartMs + hours * HOUR_MS;
  const failedRules: RuleName[] = [];
  const restHours = restHoursIn(periods, windowStartMs, windowEndMs);
  if (hours === 24) {
    if (restHours < 10) failedRules.push("rest_24h");
    const beginning = restPeriodsBeginning(periods, windowStartMs, windowEndMs);
    if (beginning > (ruleSet === "standard" ? 2 : 3)) failedRules.push("rest_periods");
    if (!hasSixHourBlock(periods, windowStartMs, windowEndMs)) failedRules.push("six_hour_block");
    if (longestNonRestRun(periods, windowStartMs, windowEndMs) > 14) failedRules.push("fourteen_hour_gap");
    if (ruleSet === "flag_exception" && beginning === 3 && countThreePeriodDays(periods, windowEndMs) > 2) {
      failedRules.push("three_period_days");
    }
  } else {
    if (restHours < (ruleSet === "standard" ? 77 : 70)) failedRules.push("rest_168h");
  }
  return { failedRules, restHours, ruleSet };
}

/** Rest hours inside [start, end), clipping periods at the edges. Short breaks never count. */
export function restHoursIn(periods: RestPeriod[], startMs: number, endMs: number): number {
  let total = 0;
  for (const period of periods) {
    if (period.shortBreak) continue;
    const from = Math.max(period.startMs, startMs);
    const to = Math.min(period.endMs, endMs);
    if (to > from) total += to - from;
  }
  return total / HOUR_MS;
}

/** Rest periods whose start instant lies inside the window, short breaks excluded. */
function restPeriodsBeginning(periods: RestPeriod[], startMs: number, endMs: number): number {
  let count = 0;
  for (const period of periods) {
    if (period.shortBreak) continue;
    if (period.startMs >= startMs && period.startMs < endMs) count++;
  }
  return count;
}

/** Whether a rest period of at least 6 hours, measured whole, overlaps the window. */
function hasSixHourBlock(periods: RestPeriod[], startMs: number, endMs: number): boolean {
  for (const period of periods) {
    if (period.shortBreak) continue;
    const length = period.endMs - period.startMs;
    if (length >= 6 * HOUR_MS && period.startMs < endMs && period.endMs > startMs) return true;
  }
  return false;
}

/** The longest unbroken run of non-rest cells inside the window, in hours. */
function longestNonRestRun(periods: RestPeriod[], startMs: number, endMs: number): number {
  // Rest periods clipped to the window, sorted, give the gaps between them.
  const clipped: RestPeriod[] = [];
  for (const period of periods) {
    if (period.shortBreak) continue;
    const from = Math.max(period.startMs, startMs);
    const to = Math.min(period.endMs, endMs);
    if (to > from) clipped.push({ startMs: from, endMs: to, shortBreak: false });
  }
  clipped.sort((a, b) => a.startMs - b.startMs);
  let longest = 0;
  let cursor = startMs;
  for (const period of clipped) {
    if (period.startMs > cursor) longest = Math.max(longest, period.startMs - cursor);
    cursor = Math.max(cursor, period.endMs);
  }
  if (endMs > cursor) longest = Math.max(longest, endMs - cursor);
  return longest / HOUR_MS;
}

/**
 * three_period_days: with exactly 3 rest periods beginning inside a 24-hour
 * window, count 24-hour blocks back from the window's end over the previous
 * 168 hours; the rule fails when more than two blocks hold exactly 3 periods
 * beginning inside them.
 */
function countThreePeriodDays(periods: RestPeriod[], windowEndMs: number): number {
  const beginCounts: number[] = [];
  for (let blockStart = windowEndMs - 168 * HOUR_MS; blockStart < windowEndMs; blockStart += 24 * HOUR_MS) {
    beginCounts.push(restPeriodsBeginning(periods, blockStart, blockStart + 24 * HOUR_MS));
  }
  return beginCounts.filter((c) => c === 3).length;
}

/**
 * Rule wording printed in the Record pane, `<limit>` from the rule set in force.
 */
export function ruleSentence(rule: RuleName, rules: RuleSetKind): string {
  switch (rule) {
    case "rest_24h":
      return "Less than 10 hours of rest in this 24-hour window.";
    case "rest_periods":
      return `Rest was split into more than ${rules === "standard" ? 2 : 3} periods in this 24-hour window.`;
    case "six_hour_block":
      return "No rest period of at least 6 hours touches this 24-hour window.";
    case "fourteen_hour_gap":
      return "More than 14 hours passed between rest periods in this 24-hour window.";
    case "rest_168h":
      return `Less than ${rules === "standard" ? 77 : 70} hours of rest in this 168-hour window.`;
    case "three_period_days":
      return "Three rest periods were used on more than two 24-hour periods in these 7 days.";
  }
}
