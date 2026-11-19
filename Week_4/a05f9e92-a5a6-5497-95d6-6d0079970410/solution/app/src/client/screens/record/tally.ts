import type { StepJson } from "../../../server/changes.js";

/** The tally copy of one approval step, with the word for a closed step. */
export function tallyText(step: StepJson): { counts: string; closed: string | null } {
  const t = step.tally;
  const counts =
    step.rule === "weighted"
      ? `Approve weight ${t.approve_weight}, reject weight ${t.reject_weight}, waiting weight ${t.waiting_weight}. Needs ${t.needed} of ${t.of}.`
      : `Approve ${t.approve}, reject ${t.reject}, waiting ${t.waiting}. Needs ${t.needed} of ${t.of}.`;
  return { counts, closed: step.status === "approved" ? "Closed: approved" : step.status === "rejected" ? "Closed: rejected" : null };
}

export const STEP_STATUS_LABELS: Record<StepJson["status"], string> = {
  not_started: "Not started",
  open: "Open",
  approved: "Approved",
  rejected: "Rejected",
};
