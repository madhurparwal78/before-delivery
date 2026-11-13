import type { RailPhase, WindowDecision } from '../shared/types.js';
import { clusterTime } from '../shared/zone.js';

export const PHASE_LABEL: Record<RailPhase, string> = {
  idle: 'Queued',
  queued: 'Queued',
  window_check: 'Blocked by window',
  applying: 'Applying',
  health_wait: 'Health wait',
  healthy: 'Healthy',
  degraded: 'Degraded',
  stopped: 'Stopped',
};

export const copy = {
  roleRefused: 'Your role in this project cannot do that.',
  networkFailed: 'Keelson could not reach the server. Your last action was not confirmed.',
  sessionEnded: 'Your session ended. Sign in again.',
  wrongCredentials: 'Email or password is wrong.',
  signingIn: 'Signing in…',

  requestingPromotion: 'Requesting promotion…',
  startedPromotion: (version: string, stage: string) => `Promotion of ${version} to ${stage} started.`,
  waitingApproval: (version: string, stage: string) =>
    `Promotion of ${version} to ${stage} is waiting for approval.`,
  blockedPromotion: (version: string, stage: string, reason: string) =>
    `Promotion of ${version} to ${stage} is blocked: ${reason}.`,
  stageHeld: (stage: string, version: string, digest: string) =>
    `${stage} is held by ${version} (${digest}). Try again when it finishes.`,
  notVerified: (version: string, upstream: string) =>
    `${version} has not reached Healthy in ${upstream} yet.`,

  recordingApproval: 'Recording approval…',
  approvedUntil: (expiry: string) => `Approved until ${expiry}. The requester will be notified.`,
  evidencePending: 'The evidence bundle is still being stored. You can approve once it is saved.',
  approvalStorageDown:
    'Evidence storage is unreachable, so the approval was not recorded. Try again when it returns.',
  requestLapsed: (expiry: string) => `This approval request expired at ${expiry}.`,

  recordingRejection: 'Recording rejection…',
  rejected: 'Rejected. The requester will be notified.',

  starting: 'Starting…',
  startedApplying: (version: string, stage: string) => `Started. Applying ${version} to ${stage}.`,
  approvalLapsed: (expiry: string) => `This approval expired at ${expiry}. Request a new promotion.`,

  checkingWindow: 'Checking the window…',

  breakingFreeze: 'Breaking the freeze…',
  freezeBroken: (version: string, stage: string) =>
    `Freeze broken. Applying ${version} to ${stage}. Release managers will be notified.`,

  startingRollback: 'Starting rollback…',
  rollingBack: (stage: string, version: string, digest: string) =>
    `Rolling ${stage} back to ${version} (${digest}).`,
  noHealthyRevision: (stage: string) => `${stage} has no earlier healthy revision to roll back to.`,
  rollbackStorageDown:
    'Evidence storage is unreachable, so the rollback could not read the last healthy bundle. Nothing was changed.',

  preparingEvidence: 'Preparing evidence…',
  evidenceDownloaded: 'Evidence downloaded.',
  noEvidenceYet: 'No evidence snapshot is stored yet. It will be saved when storage returns.',
  evidenceStorageDown: 'Evidence storage is unreachable. Try the download again when it returns.',

  savingWindow: 'Saving window…',
  windowAdded: (opens: string) => `Window added. Next opening ${opens}.`,
  windowAddedNoOpenings: 'Window added. No openings scheduled.',
  removingWindow: 'Removing window…',
  windowRemoved: 'Window removed.',

  checkingInstant: 'Checking…',
  decisionOpen: (label: string) => `Open: ${label}`,
  decisionOutsideWindow: 'Closed: outside every sync window',
  decisionFreeze: (name: string, version: number) => `Closed: freeze "${name}" (policy version ${version})`,

  scheduling: 'Scheduling…',
  versionScheduled: (version: number, effective: string) =>
    `Freeze policy version ${version} takes effect at ${effective}.`,
  staleBase: (current: number) =>
    `Someone scheduled version ${current} first. Reload to see it, then try again.`,

  storageDownNotice: 'Evidence storage is unreachable. Snapshots are queued and will be stored when it returns.',
  mailDownNotice: 'Mail is unreachable. Notices are queued and will be sent when it returns.',

  notCheckedYet: 'Not checked yet. The window is checked when the promotion starts.',
  nothingDeployed: 'Nothing deployed yet.',
  liveRevision: (digest: string) => `Live revision ${digest}`,
  redacted: '[redacted]',
};

/** `outside the sync window for <cluster> (<zone>)` or `freeze "<name>" is in force`. */
export function blockReason(
  decision: WindowDecision | null,
  cluster: string,
  timeZone: string,
): string {
  if (decision?.reason === 'freeze' && decision.freeze) {
    return `freeze "${decision.freeze.name}" is in force`;
  }
  return `outside the sync window for ${cluster} (${timeZone})`;
}

export function decisionSummary(decision: WindowDecision): string {
  if (decision.open) return copy.decisionOpen(decision.window?.label ?? 'no window required');
  if (decision.reason === 'freeze' && decision.freeze) {
    return copy.decisionFreeze(decision.freeze.name, decision.policy_version);
  }
  return copy.decisionOutsideWindow;
}

export function stamp(instant: string | null, timeZone: string): string {
  return instant ? clusterTime(instant, timeZone) : '—';
}
