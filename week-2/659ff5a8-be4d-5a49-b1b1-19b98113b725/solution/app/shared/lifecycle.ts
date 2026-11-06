/** Event and run states, and the only place that decides whether a move between them is legal. */

const EVENT_STATUSES = [
  "draft",
  "registration_open",
  "registration_closed",
  "running",
  "provisional",
  "final",
  "published",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draft",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
  running: "Running",
  provisional: "Provisional",
  final: "Final",
  published: "Published",
};

/** Moves a chair may make through the transition endpoint. `final` to `published` happens only through publish. */
const MOVES: Partial<Record<EventStatus, EventStatus>> = {
  draft: "registration_open",
  registration_open: "registration_closed",
  registration_closed: "running",
  running: "provisional",
  provisional: "final",
};

export function nextEventStatus(from: EventStatus): EventStatus | null {
  return MOVES[from] ?? null;
}

export function isLegalMove(from: EventStatus, to: string): boolean {
  return MOVES[from] === to;
}

/** The one move only publish makes: `final` to `published`. */
export const PUBLISH_MOVE = { from: "final", to: "published" } as const satisfies { from: EventStatus; to: EventStatus };

/** Why publish may not run from `from`, or null when the publish move is legal. */
export function publishRefusal(from: EventStatus): "already_published" | "not_final" | null {
  if (from === PUBLISH_MOVE.from) return null;
  return from === PUBLISH_MOVE.to ? "already_published" : "not_final";
}

/** The lifecycle button that performs the move out of `from`, by its label in the chair's overview. */
export const MOVE_BUTTON: Partial<Record<EventStatus, string>> = {
  draft: "Open registration",
  registration_open: "Close registration",
  registration_closed: "Start event",
  running: "Post provisional results",
  provisional: "Set results final",
};

/** Statuses in which the rota can change. */
export function rotaOpen(status: EventStatus): boolean {
  return status === "registration_open" || status === "registration_closed" || status === "running";
}

export function withdrawalOpen(status: EventStatus): boolean {
  return status === "registration_open" || status === "registration_closed";
}

export function checkInOpen(status: EventStatus): boolean {
  return status === "registration_closed" || status === "running";
}

export function timesCanChange(status: EventStatus): boolean {
  return status === "running" || status === "provisional";
}

const RUN_STATUSES = ["pending", "committed", "corrected", "rerun_granted"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunOutcome = "time" | "dnf" | "rerun";

export function canCommit(status: RunStatus): boolean {
  return status === "pending" || status === "rerun_granted";
}

export function canCorrect(status: RunStatus): boolean {
  return status === "committed" || status === "corrected";
}

/** The status a run takes when an outcome is committed on a slot that can take one. */
export function statusAfterCommit(outcome: RunOutcome): RunStatus {
  return outcome === "rerun" ? "rerun_granted" : "committed";
}

export const STATUS_AFTER_CORRECTION: RunStatus = "corrected";

/** Whether a run's times count toward standings. */
export function hasTime(status: RunStatus, outcome: RunOutcome | null): boolean {
  return outcome === "time" && (status === "committed" || status === "corrected");
}
