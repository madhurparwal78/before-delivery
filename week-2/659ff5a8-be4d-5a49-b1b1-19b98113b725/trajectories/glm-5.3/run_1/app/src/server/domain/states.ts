// The event state machine, registration/window state, run states and the
// rank-change text: each decided exactly here.
import type { EventStatus } from "./types.js";

export const TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ["registration_open"],
  registration_open: ["registration_closed"],
  registration_closed: ["running"],
  running: ["provisional"],
  provisional: ["final"],
  final: [],
  published: [],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const REGISTRATION_ACCEPTED: EventStatus[] = ["registration_open"];
export const WITHDRAWAL_STATUSES: EventStatus[] = ["registration_open", "registration_closed"];
export const CHECKIN_STATUSES: EventStatus[] = ["registration_closed", "running"];
export const ROTA_STATUSES: EventStatus[] = ["registration_open", "registration_closed", "running"];
export const RUN_COMMIT_STATUSES: EventStatus[] = ["running"];
export const CORRECTION_STATUSES: EventStatus[] = ["running", "provisional"];

/** Status label shown on screens. */
export function statusLabel(status: EventStatus): string {
  switch (status) {
    case "draft": return "Draft";
    case "registration_open": return "Registration open";
    case "registration_closed": return "Registration closed";
    case "running": return "Running";
    case "provisional": return "Provisional";
    case "final": return "Final";
    case "published": return "Published";
  }
}

/** Registration is open only while stored status says so and the cutoff has not passed. */
export function registrationIsOpen(status: EventStatus, cutoffUtc: Date, now: Date): boolean {
  return status === "registration_open" && now.getTime() < cutoffUtc.getTime();
}

/** The status the event reports, given the clock. */
export function reportedStatus(status: EventStatus, cutoffUtc: Date, now: Date): EventStatus {
  if (status === "registration_open" && now.getTime() >= cutoffUtc.getTime()) {
    return "registration_closed";
  }
  return status;
}

export function protestWindowOpen(closesAt: Date | null, now: Date): boolean {
  if (!closesAt) return false;
  return now.getTime() < closesAt.getTime();
}

export type RunStatus = "pending" | "committed" | "corrected" | "rerun_granted";
export type RunOutcome = "time" | "dnf" | "rerun" | null;

/** A run slot may be committed when pending or rerun-granted. */
export function runCanBeCommitted(status: string): boolean {
  return status === "pending" || status === "rerun_granted";
}

/** A run may be corrected when committed or corrected. */
export function runCanBeCorrected(status: string): boolean {
  return status === "committed" || status === "corrected";
}

/** The published rank-change badge text, per view. */
export function rankChangeText(previous: number | null, current: number | null): string {
  if (current === null) return "No time";
  if (previous === null) return `New P${current}`;
  if (previous === current) return `Holds P${current}`;
  if (previous > current) return `Up ${previous - current} to P${current}`;
  return `Down ${current - previous} to P${current}`;
}

/** Standings tie-break: lower car number, then class code alphabetically. */
export function entryTieBreak(
  a: { carNumber: number; classCode: string },
  b: { carNumber: number; classCode: string },
): number {
  if (a.carNumber !== b.carNumber) return a.carNumber - b.carNumber;
  return a.classCode < b.classCode ? -1 : a.classCode > b.classCode ? 1 : 0;
}
