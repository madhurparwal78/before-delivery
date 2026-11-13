import type { Tranche, TrancheState, VestingType } from "../../shared/types.js";
import { addMonthsClamped, compareYmd, formatYmd, parseYmd } from "./dates.js";
import { exerciseCostCents, formatCents, formatPercent, percentHundredths } from "./money.js";

export const LAST_MARK = 48;
export const CLIFF_MARK = 12;

/** The date of month mark m: the vesting start plus m calendar months, clamped to month end. */
export function markDate(vestingStart: string, mark: number): string {
  const start = parseYmd(vestingStart);
  if (start === null) throw new Error(`vesting start is not a calendar date: ${vestingStart}`);
  return formatYmd(addMonthsClamped(start, mark));
}

/** Cumulative vested options at month mark m, by the published floor rule. */
export function cumulativeAt(options: number, vestingType: VestingType, mark: number): number {
  if (mark <= 0) return 0;
  if (vestingType === "standard" && mark < CLIFF_MARK) return 0;
  return Math.floor((options * Math.min(mark, LAST_MARK)) / LAST_MARK);
}

/** The latest mark whose date is on or before the given date, or 0 before the start. */
export function markOn(vestingStart: string, date: string): number {
  let latest = 0;
  for (let mark = 1; mark <= LAST_MARK; mark += 1) {
    if (compareYmd(markDate(vestingStart, mark), date) <= 0) latest = mark;
    else break;
  }
  return latest;
}

export interface ScheduleInput {
  options: number;
  strike: bigint;
  vestingType: VestingType;
  vestingStart: string;
  serverDate: string;
  exercised: number;
  cancelled: number;
  terminationDate: string | null;
  windowEnded: boolean;
  holderIssuedShares: number;
  fullyDilutedTotal: number;
}

/** Gross vested options on the server date, stopping at a leaver's termination date. */
export function vestedOptions(input: ScheduleInput): number {
  const countingDate =
    input.terminationDate !== null && compareYmd(input.terminationDate, input.serverDate) < 0
      ? input.terminationDate
      : input.serverDate;
  return cumulativeAt(input.options, input.vestingType, markOn(input.vestingStart, countingDate));
}

function cumulativeForMark(input: ScheduleInput, mark: number): number {
  if (input.terminationDate !== null && compareYmd(markDate(input.vestingStart, mark), input.terminationDate) > 0) {
    return vestedOptions(input);
  }
  return cumulativeAt(input.options, input.vestingType, mark);
}

function trancheState(input: ScheduleInput, mark: number, cumulative: number): TrancheState {
  const date = markDate(input.vestingStart, mark);
  if (input.terminationDate !== null && compareYmd(date, input.terminationDate) > 0) return "cancelled";
  if (input.windowEnded) return cumulative <= input.exercised ? "vested" : "cancelled";
  if (compareYmd(date, input.serverDate) <= 0) return "vested";
  return "unvested";
}

export function buildSchedule(input: ScheduleInput): Tranche[] {
  const schedule: Tranche[] = [];
  for (let mark = 0; mark <= LAST_MARK; mark += 1) {
    const cumulative = cumulativeForMark(input, mark);
    const live = Math.max(0, cumulative - input.exercised - input.cancelled);
    const ownership =
      input.fullyDilutedTotal === 0
        ? 0n
        : percentHundredths(BigInt(input.holderIssuedShares + live), BigInt(input.fullyDilutedTotal));
    schedule.push({
      month: mark,
      date: markDate(input.vestingStart, mark),
      cumulative,
      state: trancheState(input, mark, cumulative),
      cost_at_strike: formatCents(exerciseCostCents(live, input.strike)),
      vested_ownership: formatPercent(ownership),
    });
  }
  return schedule;
}

/** The next mark after the server date at which more options vest. */
export function nextTranche(input: ScheduleInput): { date: string; cumulative: number } | null {
  if (input.terminationDate !== null) return null;
  const vested = vestedOptions(input);
  for (let mark = 1; mark <= LAST_MARK; mark += 1) {
    const date = markDate(input.vestingStart, mark);
    if (compareYmd(date, input.serverDate) <= 0) continue;
    const cumulative = cumulativeAt(input.options, input.vestingType, mark);
    if (cumulative > vested) return { date, cumulative };
  }
  return null;
}
