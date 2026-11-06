// Every visible sentence the brief publishes, in one place. Apostrophes are straight.

import { signed } from "./format";

export const COPY = {
  wrongCredentials: "That email and password do not match.",
  noReadings: "No readings have been ingested for this project yet.",
  toBeforeFrom: "The To date must be on or after the From date.",
  previewFailed: "Could not load the figure for this interval. Move the brush to try again.",
  roleAnalyst: "Your role on this project can preview figures but not seal them.",
  roleViewer: "Your role on this project can view sealed figures but not preview new ones.",
  lostAccess: "You no longer have access to this project.",
  readingsChanged: "Readings in this interval changed since the preview. Check the new figure before sealing.",
  sealingLabel: "Sealing...",
  sealingStatus: "Sealing figure. Waiting for evidence storage to confirm.",
  storageUnreachable: "Evidence storage is unreachable, so nothing was sealed. Try again in a few minutes.",
  mailRefused: "The seal notice could not be sent, so nothing was sealed. Try again in a few minutes.",
  noAnswer: "No answer from the server yet. Confirm seal again to retry safely.",
  auditEmpty: "No readings have moved since this figure was sealed.",
  linkRevoked: "Link revoked.",
  linkNotIssuable: "Only an intact sealed figure can have a regulator link.",
  linkAlreadyExpired: "This link has already expired.",
  rederivePending: "Re-deriving from the stored readings.",
  rederiveFailed: "Could not re-derive right now. Try again in a few minutes.",
  fileUnavailable: "The readings file is unavailable while evidence storage is unreachable. Try again in a few minutes.",
  fileMismatch: "The stored readings file does not match this figure's fingerprint.",
  grantFailed: "Access was not changed. Try again.",
  expired: { heading: "This link has expired", line: "Ask the project team for a new link." },
  revoked: { heading: "This link was revoked", line: "The project team withdrew this link." },
  unknown: { heading: "No sealed figure is published at this link", line: "Check the address you were given." },
} as const;

const head = (coverage: string, net: string) => `Coverage ${coverage}%, net ${signed(net)} tCO2e.`;

export const settledSealable = (coverage: string, net: string) => `${head(coverage, net)} Seal available.`;
export const settledBelowFloor = (coverage: string, net: string, floor: string) => `${head(coverage, net)} Below the ${floor}% floor.`;
export const settledBlocked = (coverage: string, net: string) => `${head(coverage, net)} Seal unavailable.`;
export const belowFloor = (coverage: string, floor: string) =>
  `Coverage ${coverage}% is below this project's ${floor}% floor, so this figure cannot be sealed.`;
export const overlaps = (figureId: string) => `This interval overlaps sealed figure ${figureId}. Choose an interval that does not overlap it.`;
export const alreadySealed = (figureId: string) => `This interval is already sealed as ${figureId}.`;
export const sealed = (figureId: string, net: string, coverage: string, supersedes: string | null) =>
  `Sealed ${figureId}: ${signed(net)} tCO2e at ${coverage}% coverage.${supersedes ? ` Supersedes ${supersedes}.` : ""}`;
export const brokenOn = (figureIds: string[]) =>
  [...figureIds].sort().map((id) => `Seal broken on ${id}. Its tonnes have been reversed in the ledger.`).join(" ");
export const brokenBanner = (moved: number) =>
  `Seal broken. Readings moved since sealing: ${moved}. Its tonnes have been reversed in the ledger.`;
export const supersededBy = (figureId: string) => `Superseded by ${figureId}.`;
export const linkIssued = (expiresDisplay: string) => `Regulator link issued. It expires ${expiresDisplay}.`;
export const grantSaved = (person: string, project: string, roleLabel: string) => `Saved access for ${person} on ${project}: ${roleLabel}.`;
export const rederived = (checkedDisplay: string, verdict: "Intact" | "Broken" | "Superseded") => `Re-derived at ${checkedDisplay}: ${verdict}.`;
