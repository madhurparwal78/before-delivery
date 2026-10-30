import { formatDate, zoneToday } from "../../shared/format.js";
import { illegalTransition } from "../http/errors.js";
import type { Fields } from "../http/validate.js";
import { defectsEndOn } from "./calendar.js";

// The snag state machine, the closed-snag move rule and the observed-date rules (brief: Snags).
// The one place each of them is decided.

export type SnagState = "open" | "fixed" | "closed" | "reopened";
type SnagAction = "fix" | "close" | "reopen";
export const SNAG_ACTIONS: readonly SnagAction[] = ["fix", "close", "reopen"];

const TRANSITIONS: Record<SnagAction, { from: readonly SnagState[]; to: SnagState }> = {
  fix: { from: ["open", "reopened"], to: "fixed" },
  close: { from: ["fixed"], to: "closed" },
  reopen: { from: ["fixed", "closed"], to: "reopened" },
};

/** The state after `action`, or 409 illegal_transition. */
export function snagTransition(state: SnagState, action: SnagAction): SnagState {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(state)) throw illegalTransition(state, action);
  return rule.to;
}

/**
 * The moves open to a caller who may make `permitted` transitions (and, with `mayMove`, move snags):
 * the transitions whose rule admits the current state, plus `move` unless the snag is closed.
 */
export function snagActions(state: SnagState, permitted: readonly SnagAction[], mayMove: boolean): (SnagAction | "move")[] {
  const open: (SnagAction | "move")[] = permitted.filter((action) => TRANSITIONS[action].from.includes(state));
  return mayMove && state !== "closed" ? [...open, "move"] : open;
}

/** A closed snag cannot move. */
export function assertMovable(state: SnagState): void {
  if (state === "closed") throw illegalTransition(state, "move");
}

/** Observed on: not after today in Hong Kong and, once practical completion is recorded, not after the defects end date. */
export function checkObservedOn(fields: Fields, observedOn: string, project: { practicalCompletionOn: string | null; defectsPeriodMonths: number }): void {
  if (fields.has("observedOn")) return;
  if (observedOn > zoneToday("Asia/Hong_Kong")) {
    fields.fail("observedOn", "Observed on can't be in the future.");
    return;
  }
  const end = defectsEndOn(project.practicalCompletionOn, project.defectsPeriodMonths);
  if (end !== null && observedOn > end) {
    fields.fail("observedOn", `This defect was observed after the defects period ended on ${formatDate(end)}.`);
  }
}
