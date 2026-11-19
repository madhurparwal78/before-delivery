/** Every published string. Exact to the character. */

import { chainage, countOf, measure } from "./format.js";

export const SIGN_IN_FAILED = "That access code is not recognised.";

export const NO_FLIGHT_COVERAGE = "No flight coverage";

export const DRONE_LOCATING = "Drone locating...";

export const STORAGE_BANNER =
  "Tile storage is unreachable. Findings stay editable, and tiles will reload when storage is back.";

export const EMPTY_VIEWPORT =
  "No tiles can be shown right now. Use the span ribbon and the findings rail to keep working.";

export const NO_WEBGL = "3D view needs WebGL. The span ribbon and findings rail still work.";

export const NO_ASSETS = "No survey assets stored for this corridor yet.";

export const NO_FINDINGS_SET = "No findings set for this corridor yet.";

export const DECISIONS_FINAL = "Decisions for this revision are final.";

export const LINK_EXPIRED_PAGE =
  "This review link has expired. Ask your survey contractor for a new one.";
export const LINK_WITHDRAWN_PAGE =
  "This review link has been withdrawn. Ask your survey contractor for a new one.";
export const LINK_UNKNOWN_PAGE = "This review link does not exist.";

export const VIEW_LINK_COPIED = "View link copied.";

export const STORAGE_UNAVAILABLE_MESSAGE = "Tile storage is unreachable.";

export const SUBMIT_NEEDS_STORAGE =
  "Submit needs tile storage to write the evidence pack. Try again when storage is back.";

export const ALREADY_SUBMITTED = "This findings set was already submitted.";

export const UPLOAD_STORAGE_UNREACHABLE =
  "Tile storage is unreachable. Upload paused; nothing was stored.";

export const UPLOAD_INVALID_TRACK =
  "Flight track rejected: no position samples with an epoch and availability.";

export const SET_CLOSED = "Findings set closed.";

export const LINK_WITHDRAWN_STATUS = "Review link withdrawn.";

export const SEND_DECISIONS_FAILED = "Could not send the decisions. Try again.";

export function savingFinding(label: string): string {
  return `Saving ${label}...`;
}

export function savedFinding(label: string, clearanceM: number, status: "violation" | "clear"): string {
  return `Saved ${label}. Clearance ${measure(clearanceM)} m, ${
    status === "violation" ? "Violation" : "Clear"
  }.`;
}

export function saveFailedFields(label: string): string {
  return `Could not save ${label}. Check the highlighted fields.`;
}

export function deletedFinding(label: string): string {
  return `Deleted ${label}.`;
}

export function terrainRefined(
  label: string,
  groundHeightM: number,
  terrainLevel: number,
  clearanceM: number,
  status: "violation" | "clear",
): string {
  return `Ground height for ${label} re-resolved to ${measure(groundHeightM)} m at terrain level ${terrainLevel}. Clearance now ${measure(
    clearanceM,
  )} m, ${status === "violation" ? "Violation" : "Clear"}.`;
}

export function selectedFinding(label: string, spanLabelText: string, chainageM: number): string {
  return `Selected ${label}, ${spanLabelText}, chainage ${chainage(chainageM)} m.`;
}

export function submitting(revision: number): string {
  return `Submitting revision ${revision}...`;
}

export function submittedSent(revision: number, email: string): string {
  return `Submitted revision ${revision}. Review link emailed to ${email}.`;
}

export function submittedQueued(revision: number, email: string): string {
  return `Submitted revision ${revision}. The email to ${email} is queued and will send when mail is back.`;
}

export function linkResent(email: string): string {
  return `Review link resent to ${email}.`;
}

export function newLinkSent(email: string): string {
  return `New review link sent to ${email}. The previous link no longer works.`;
}

export function emailQueued(email: string): string {
  return `The email to ${email} is queued and will send when mail is back.`;
}

export function revisionStarted(revision: number): string {
  return `Revision ${revision} started as a draft.`;
}

export function uploadProgress(done: number, total: number, kindLabel: string): string {
  return `Uploading ${done} of ${total} files for ${kindLabel}`;
}

export function uploadVerifying(total: number): string {
  return `Verifying ${countOf(total, "file")} with storage`;
}

export function uploadStored(kindLabel: string, total: number): string {
  return `${kindLabel} stored: ${countOf(total, "file")} verified.`;
}

export function uploadMismatch(kindLabel: string, path: string): string {
  return `${kindLabel} rejected: ${path} did not match its checksum.`;
}

export function decisionSaved(label: string, decision: "accept" | "dispute"): string {
  return `${label} marked ${decision === "accept" ? "accepted" : "disputed"}.`;
}

export function decisionsSent(accepted: number, disputed: number): string {
  return `Decisions sent: ${accepted} accepted, ${disputed} disputed.`;
}

export function decisionFailed(label: string): string {
  return `Could not save the decision for ${label}. Try again.`;
}

export function streamingTiles(count: number): string {
  return `Streaming ${countOf(count, "tile")}`;
}

export function railSummary(findings: number, violations: number): string {
  return `${countOf(findings, "finding")} \u00b7 ${countOf(violations, "violation")}`;
}

export function submitDialogBody(findings: number, violations: number, email: string): string {
  return `${countOf(findings, "finding")}, ${countOf(
    violations,
    "violation",
  )} will be frozen and sent to ${email}.`;
}
