// Placement lifecycle (brief: Business rules, Placement lifecycle).
export type PlacementStatus = "proposed" | "claimed" | "hung" | "signed_off" | "removed";
type PlacementAction = "claim" | "release" | "hang" | "sign-off" | "remove" | "restore";

const TRANSITIONS: Record<PlacementAction, { from: PlacementStatus; to: PlacementStatus }> = {
  claim: { from: "proposed", to: "claimed" },
  release: { from: "claimed", to: "proposed" },
  hang: { from: "claimed", to: "hung" },
  "sign-off": { from: "hung", to: "signed_off" },
  remove: { from: "proposed", to: "removed" },
  restore: { from: "removed", to: "proposed" },
};

/** The status an action leads to, or null when the action is not legal from `current`. */
export function nextStatus(action: PlacementAction, current: PlacementStatus): PlacementStatus | null {
  const step = TRANSITIONS[action];
  return step.from === current ? step.to : null;
}

/** Statuses in which nobody may move a placement. */
export function isLocked(status: PlacementStatus): boolean {
  return status === "hung" || status === "signed_off" || status === "removed";
}
