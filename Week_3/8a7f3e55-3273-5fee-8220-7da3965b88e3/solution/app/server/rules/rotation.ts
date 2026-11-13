import type { CoverageState } from "../../shared/api.js";
import { AGENCY, addMinutes } from "../agency.js";
import { coverageState } from "./status.js";

export interface PlanHolder {
  name: string;
  initials: string;
}

export interface PlanEntry {
  index: number;
  kind: "turn" | "gap";
  seat: number | null;
  holder: PlanHolder | null;
  startMs: number;
  endMs: number;
  label: "relief needed" | "uncovered" | null;
}

export interface RotationPlan {
  mode: "solo" | "team";
  intervalMinutes: number;
  thresholdMinutes: number;
  coverageText: string;
  entries: PlanEntry[];
  coverage: { state: CoverageState; covered_minutes: number; percent: number };
}

interface PlanInput {
  startMs: number;
  durationMinutes: number;
  intervalMinutes: number;
  /** One entry per seat, in seat order; null when vacant. */
  holders: (PlanHolder | null)[];
}

/** The rotation plan: turns and gaps computed from the seats, the contract interval and the solo threshold. */
export function planRotation(input: PlanInput): RotationPlan {
  const { startMs, durationMinutes: duration, intervalMinutes: interval, holders } = input;
  const threshold = AGENCY.soloThresholdMinutes;
  const seatCount = holders.length;
  const held = holders.filter((holder) => holder !== null).length;
  const endMs = addMinutes(startMs, duration);
  const entries: PlanEntry[] = [];
  const team = seatCount === 2 && held === 2;
  let coveredMinutes: number;

  if (team) {
    const turnCount = Math.ceil(duration / interval);
    for (let i = 0; i < turnCount; i += 1) {
      const seat = i % 2 === 0 ? 1 : 2;
      entries.push({
        index: i,
        kind: "turn",
        seat,
        holder: holders[seat - 1] ?? null,
        startMs: addMinutes(startMs, i * interval),
        endMs: Math.min(addMinutes(startMs, (i + 1) * interval), endMs),
        label: null,
      });
    }
    coveredMinutes = duration;
  } else {
    const heldSeat = holders.findIndex((holder) => holder !== null) + 1;
    if (held > 0) {
      const turnMinutes = seatCount === 2 ? Math.min(duration, threshold) : duration;
      const turnEnd = addMinutes(startMs, turnMinutes);
      entries.push({ index: 0, kind: "turn", seat: heldSeat, holder: holders[heldSeat - 1] ?? null, startMs, endMs: turnEnd, label: null });
      if (turnMinutes < duration) {
        entries.push({ index: 1, kind: "gap", seat: null, holder: null, startMs: turnEnd, endMs, label: "relief needed" });
      }
      coveredMinutes = turnMinutes;
    } else {
      entries.push({ index: 0, kind: "gap", seat: null, holder: null, startMs, endMs, label: "uncovered" });
      coveredMinutes = 0;
    }
  }
  const percent = Math.floor((coveredMinutes * 100) / duration);
  const coverageText = team
    ? `Team · ${entries.length} turns · 100% covered`
    : `${seatCount === 2 ? "Team" : "Solo"} · ${coveredMinutes} of ${duration} min · ${percent}% covered`;

  return {
    mode: seatCount === 2 ? "team" : "solo",
    intervalMinutes: interval,
    thresholdMinutes: threshold,
    coverageText,
    entries,
    coverage: {
      state: coverageState(seatCount, held),
      covered_minutes: coveredMinutes,
      percent,
    },
  };
}
