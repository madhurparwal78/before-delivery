// The version lifecycle table (Business rules › Version lifecycle).
import type { VersionState } from "../../shared/api-types.js";
import { invalidTransition } from "../errors.js";

export type VersionMove = "submit" | "schedule" | "unschedule" | "publish" | "withdraw";

const MOVES: Record<VersionMove, { from: VersionState; to: VersionState }> = {
  submit: { from: "draft", to: "in_review" },
  schedule: { from: "in_review", to: "scheduled" },
  unschedule: { from: "scheduled", to: "in_review" },
  publish: { from: "scheduled", to: "published" },
  withdraw: { from: "published", to: "withdrawn" },
};

/** The state a legal move leads to; any other move is the transition conflict. */
export function nextState(current: VersionState, move: VersionMove): VersionState {
  const { from, to } = MOVES[move];
  if (current !== from) throw invalidTransition(current, to);
  return to;
}

export const REVIEWABLE: readonly VersionState[] = ["draft", "in_review", "scheduled"];
