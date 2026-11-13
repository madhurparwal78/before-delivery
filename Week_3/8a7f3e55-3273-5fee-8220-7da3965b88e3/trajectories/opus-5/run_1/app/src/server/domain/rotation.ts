import type { RotationEntry, RotationPlan } from '../../shared/api.js';
import { AGENCY } from './agency.js';
import { addMinutes, agencyIso } from './time.js';

export interface PlanSeat {
  seat: number;
  holderName: string | null;
  holderInitials: string | null;
}

export interface PlanInput {
  start: Date;
  durationMinutes: number;
  seatCount: number;
  intervalMinutes: number;
  seats: readonly PlanSeat[];
}

export interface Plan {
  rotation: RotationPlan;
  coveredMinutes: number;
  percent: number;
}

function entry(
  start: Date,
  index: number,
  fromMinute: number,
  toMinute: number,
  held: PlanSeat | null,
  label: string | null,
): RotationEntry {
  return {
    index,
    kind: held ? 'turn' : 'gap',
    seat: held ? held.seat : null,
    holder_name: held ? held.holderName : null,
    holder_initials: held ? held.holderInitials : null,
    start: agencyIso(addMinutes(start, fromMinute)),
    end: agencyIso(addMinutes(start, toMinute)),
    label,
  };
}

/**
 * The rotation plan is the single source of turns, gaps and coverage: boundaries are
 * elapsed minutes from the start, rendered at the agency offset in force at each instant.
 */
export function buildPlan(input: PlanInput): Plan {
  const { start, durationMinutes: duration, seatCount, intervalMinutes } = input;
  const threshold = AGENCY.soloThresholdMinutes;
  const mode = seatCount === 2 ? 'team' : 'solo';
  const modeWord = seatCount === 2 ? 'Team' : 'Solo';
  const held = input.seats.filter((seat) => seat.holderName !== null);
  const seatOne = input.seats.find((seat) => seat.seat === 1 && seat.holderName !== null) ?? null;
  const seatTwo = input.seats.find((seat) => seat.seat === 2 && seat.holderName !== null) ?? null;

  if (seatCount === 2 && seatOne && seatTwo) {
    const turnCount = Math.ceil(duration / intervalMinutes);
    const turns: RotationEntry[] = [];
    for (let index = 0; index < turnCount; index += 1) {
      const from = index * intervalMinutes;
      const to = Math.min(from + intervalMinutes, duration);
      turns.push(entry(start, index, from, to, index % 2 === 0 ? seatOne : seatTwo, null));
    }
    return {
      rotation: {
        mode,
        interval_minutes: intervalMinutes,
        threshold_minutes: threshold,
        coverage_text: `Team · ${turnCount} turns · 100% covered`,
        turns,
      },
      coveredMinutes: duration,
      percent: 100,
    };
  }

  const holder = held[0] ?? null;
  const turnLength = holder === null ? 0 : seatCount === 2 ? Math.min(duration, threshold) : duration;
  const entries: RotationEntry[] = [];
  if (holder === null) {
    entries.push(entry(start, 0, 0, duration, null, 'uncovered'));
  } else {
    entries.push(entry(start, 0, 0, turnLength, holder, null));
    if (turnLength < duration) {
      entries.push(entry(start, 1, turnLength, duration, null, 'relief needed'));
    }
  }
  const percent = Math.floor((turnLength * 100) / duration);
  return {
    rotation: {
      mode,
      interval_minutes: intervalMinutes,
      threshold_minutes: threshold,
      coverage_text: `${modeWord} · ${turnLength} of ${duration} min · ${percent}% covered`,
      turns: entries,
    },
    coveredMinutes: turnLength,
    percent,
  };
}
