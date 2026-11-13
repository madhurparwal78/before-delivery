import type { CellState, Tranche, VestingType } from "../shared/types.js";
import { exerciseCostCents, floorDivide, formatMoney, percentText } from "./decimal.js";
import { addMonths } from "./time.js";

import { CLIFF_MONTHS, MARKS } from "../shared/vesting.js";

const markDate = (vestingStart: string, mark: number): string => addMonths(vestingStart, mark);

/** Options vested at a month mark: whole options by the floor rule, nothing before the cliff of a standard grant. */
export function cumulativeAt(options: number, vestingType: VestingType, mark: number): number {
  if (vestingType === "standard" && mark < CLIFF_MONTHS) return 0;
  return floorDivide(options * mark, MARKS);
}

/** The latest mark whose date is on or before `asOf`, or null while the vesting start is still ahead. */
export function latestMark(vestingStart: string, asOf: string): number | null {
  for (let mark = MARKS; mark >= 0; mark -= 1) {
    if (markDate(vestingStart, mark) <= asOf) return mark;
  }
  return null;
}

export function nextTranche(
  options: number,
  vestingType: VestingType,
  vestingStart: string,
  asOf: string,
): { date: string; cumulative: number } | null {
  const latest = latestMark(vestingStart, asOf) ?? 0;
  const next = vestingType === "standard" && latest < CLIFF_MONTHS ? CLIFF_MONTHS : latest + 1;
  if (next > MARKS) return null;
  return { date: markDate(vestingStart, next), cumulative: cumulativeAt(options, vestingType, next) };
}

export type VestingBasis = {
  options: number;
  vestingType: VestingType;
  vestingStart: string;
  serverDate: string;
  terminationDate: string | null;
};

type ScheduleInput = VestingBasis & {
  strikeUnits: bigint;
  accepted: boolean;
  cancelledAtWindowEnd: boolean;
  exercised: number;
  cancelled: number;
  holderIssued: number;
  fullyDilutedTotal: number;
};

/** Options vested on the grant's vesting date: the server date, or the termination date once a departure froze vesting. */
export function vestedOn(input: VestingBasis): number {
  const asOf = input.terminationDate ?? input.serverDate;
  const mark = latestMark(input.vestingStart, asOf);
  return mark === null ? 0 : cumulativeAt(input.options, input.vestingType, mark);
}

function cellState(input: ScheduleInput, date: string, cumulative: number): CellState {
  if (input.terminationDate !== null && date > input.terminationDate) return "cancelled";
  const reached = input.accepted && date <= input.serverDate;
  if (reached && input.cancelledAtWindowEnd && cumulative > input.exercised) return "cancelled";
  return reached ? "vested" : "unvested";
}

/** The whole schedule, months 0 through 48, with the figures the projection marker shows. */
export function buildSchedule(input: ScheduleInput): Tranche[] {
  const vested = input.accepted ? vestedOn(input) : 0;
  const held = (cumulative: number) => Math.max(0, cumulative - input.exercised - input.cancelled);
  return Array.from({ length: MARKS + 1 }, (_, month) => {
    const date = markDate(input.vestingStart, month);
    const frozen = input.terminationDate !== null && date > input.terminationDate;
    const cumulative = frozen ? vested : cumulativeAt(input.options, input.vestingType, month);
    return {
      month,
      date,
      cumulative,
      state: cellState(input, date, cumulative),
      cost_at_strike: formatMoney(exerciseCostCents(held(cumulative), input.strikeUnits)),
      vested_ownership: percentText(input.holderIssued + held(cumulative), input.fullyDilutedTotal),
    };
  });
}
