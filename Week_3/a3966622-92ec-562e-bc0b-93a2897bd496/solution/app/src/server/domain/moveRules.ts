// The move state machine's one table: which statuses permit each action, and which actions a
// reader may take now. Every check on the server and every control on screen reads it.
import type { MoveAction, MoveStatus } from "../../shared/types.js";
import type { MoveRecord, UserRecord } from "../store.js";
import { detained } from "./moveClock.js";

const PERMITTED: Readonly<Record<MoveAction | "refuse_boarding" | "invoice", readonly MoveStatus[]>> = {
  commit: ["Ordered", "Window committed"],
  assign: ["Window committed"],
  amend: ["Ordered", "Window committed", "Pilot assigned"],
  cancel: ["Ordered", "Window committed", "Pilot assigned", "Pilot away"],
  pilot_away: ["Pilot assigned"],
  boarding: ["Pilot away"],
  complete: ["On board"],
  start_detention: ["On board"],
  stop_detention: ["On board"],
  ladder_report: ["Pilot away", "On board"],
  refuse_boarding: ["Pilot away"],
  reorder: ["Refused at ladder"],
  invoice: ["Completed"],
};

export const permits = (action: keyof typeof PERMITTED, move: MoveRecord): boolean => PERMITTED[action].includes(move.status);

/** The status a transition request moves to, keyed by the action that takes it there. */
export const TRANSITIONS: Readonly<Record<string, MoveAction>> = {
  "Pilot away": "pilot_away",
  "On board": "boarding",
  Completed: "complete",
};

/** Statuses that hold a committed window that a tide revision or amendment must re-check. */
export const PLANNED: readonly MoveStatus[] = ["Window committed", "Pilot assigned"];

/** A pilot's current assignment: assigned, away or on board. */
export const CURRENT_ASSIGNMENT: readonly MoveStatus[] = ["Pilot assigned", "Pilot away", "On board"];

/** The actions this reader may take on the move as it stands. */
export function actionsFor(move: MoveRecord, viewer: UserRecord): MoveAction[] {
  const crew = viewer.role === "dispatcher" || (viewer.role === "pilot" && viewer.id === move.pilot_id);
  const held = detained(move);
  const allowed: [MoveAction, boolean][] = [
    ["commit", viewer.role === "dispatcher"],
    ["assign", viewer.role === "dispatcher"],
    ["amend", viewer.role === "dispatcher" || viewer.role === "agent"],
    ["cancel", viewer.role === "dispatcher" || viewer.role === "agent"],
    ["reorder", viewer.role === "agent"],
    ["pilot_away", crew],
    ["boarding", crew],
    ["complete", crew && !held],
    ["start_detention", crew && !held],
    ["stop_detention", crew && held],
    ["ladder_report", crew],
  ];
  return allowed.filter(([action, who]) => who && permits(action, move)).map(([action]) => action);
}
