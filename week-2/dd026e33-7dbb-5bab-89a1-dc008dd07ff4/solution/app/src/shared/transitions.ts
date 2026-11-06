// The job and release transition tables (brief: Business rules › Workshop job states, Release
// states). The server refuses every other move with invalid_transition; the screens show an action's
// button only while this table allows it.
import type { JobStatus, ReleaseStatus } from "./api.js";

type JobAction = "edit" | "send" | "revise" | "answer" | "log_stage" | "add_reading" | "finish" | "issue_invoice";

const JOB_FROM: Record<JobAction, readonly JobStatus[]> = {
  edit: ["draft"],
  send: ["draft"],
  revise: ["declined", "expired"],
  answer: ["sent"],
  log_stage: ["approved", "in_progress"],
  add_reading: ["in_progress"],
  finish: ["in_progress"],
  issue_invoice: ["finished"],
};

/** Whether the action is legal from the job's current (effective) status. */
export function jobActionAllowed(action: JobAction, status: JobStatus): boolean {
  return JOB_FROM[action].includes(status);
}

export type ReleaseAction = "book" | "stage" | "complete" | "cancel";

export const OPEN_RELEASE: readonly ReleaseStatus[] = ["requested", "booked", "staged"];

const RELEASE_FROM: Record<ReleaseAction, readonly ReleaseStatus[]> = {
  book: ["requested"],
  stage: ["booked"],
  complete: ["staged"],
  cancel: OPEN_RELEASE,
};

/** Whether the action is legal from the release's status; owners cancel only before staging. */
export function releaseActionAllowed(action: ReleaseAction, status: ReleaseStatus, byOwner = false): boolean {
  if (action === "cancel" && byOwner) return status === "requested" || status === "booked";
  return RELEASE_FROM[action].includes(status);
}
