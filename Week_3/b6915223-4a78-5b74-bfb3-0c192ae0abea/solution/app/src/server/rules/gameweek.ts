import type { GameweekStatus } from "../../shared/api.ts";
import { ApiError, conflict } from "../errors.ts";

// Gameweek states: upcoming → open → locked → live → closed, in that order only (brief: Gameweek states).
const STEPS = {
  open: { from: "upcoming", code: "gameweek_not_open", says: "cannot open" },
  publish: { from: "open", code: "gameweek_not_open", says: "is not open" },
  lock: { from: "open", code: "gameweek_not_open", says: "is not open" },
  start: { from: "locked", code: "gameweek_not_locked", says: "is not locked" },
  kickoff: { from: "locked", code: "gameweek_not_locked", says: "is not locked" },
  record: { from: "live", code: "gameweek_not_live", says: "is not live" },
  close: { from: "live", code: "gameweek_not_live", says: "is not live" },
} as const satisfies Record<string, { from: GameweekStatus; code: string; says: string }>;

type Step = keyof typeof STEPS;

export function canStep(status: GameweekStatus, step: Step): boolean {
  return status === STEPS[step].from;
}

export function assertStep(number: number, status: GameweekStatus, step: Step): void {
  const rule = STEPS[step];
  if (status !== rule.from) throw conflict(rule.code, `Gameweek ${number} ${rule.says}.`);
}

export const DEADLINE_LEAD_MS = 90 * 60 * 1000;

export function deadlinePassed(deadline: Date | null, now: Date): boolean {
  return deadline !== null && now >= deadline;
}

// A manager write is refused once the deadline has passed, even before the lock step has finished.
export function managerWriteRefusal(number: number, status: GameweekStatus, deadline: Date | null, now: Date): ApiError | null {
  if (status === "upcoming") return conflict("gameweek_not_open", `Gameweek ${number} is not open.`);
  if (status !== "open" || deadlinePassed(deadline, now)) {
    return conflict("gameweek_locked", `Deadline passed. Gameweek ${number} is locked, so this change was not saved.`);
  }
  return null;
}
