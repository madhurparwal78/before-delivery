// The findings-set rules shared by the server (which enforces them) and the page (which offers only
// the actions they allow): the transition table, the draft rule, the open-set rule and frozen counts.

export type SetState = "draft" | "submitted" | "under_review" | "accepted" | "disputed" | "closed";
export type SetAction = "submit" | "close" | "revise" | "regenerate";

const TRANSITIONS: Record<SetAction, { from: readonly SetState[]; to: SetState | "unchanged" }> = {
  submit: { from: ["draft"], to: "submitted" },
  close: { from: ["accepted"], to: "closed" },
  revise: { from: ["disputed"], to: "closed" },
  regenerate: { from: ["submitted", "under_review", "accepted", "disputed"], to: "unchanged" },
};

/** The state an action leads to, or null when the transition table does not allow it. */
export function nextState(state: SetState, action: SetAction): SetState | null {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(state)) return null;
  return rule.to === "unchanged" ? state : rule.to;
}

/** Findings are created, edited, deleted and re-resolved only in a draft. */
export function acceptsFindingChanges(state: SetState): boolean {
  return state === "draft";
}

/** A corridor may start a set only when it has no set that is not closed. */
export function allowsNewSet(current: SetState | null): boolean {
  return current === null || current === "closed";
}

/** Decisions and completion are open from submit until the forester sends the decisions. */
export function reviewOpen(state: SetState): boolean {
  return state === "submitted" || state === "under_review";
}

/** The counts frozen at submit (and previewed before it). */
export function frozenCounts(statuses: readonly string[]): { finding_count: number; violation_count: number } {
  return { finding_count: statuses.length, violation_count: statuses.filter((s) => s === "violation").length };
}
