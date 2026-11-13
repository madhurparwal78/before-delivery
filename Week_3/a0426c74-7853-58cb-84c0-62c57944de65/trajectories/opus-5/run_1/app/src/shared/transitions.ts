export type VersionState = 'publishing' | 'published' | 'in_review' | 'approved' | 'rejected' | 'voided';
export type IssueState = 'open' | 'answered' | 'closed';
export type RfiState = 'draft' | 'sent' | 'answered' | 'closed';
export type ExportState = 'queued' | 'running' | 'ready' | 'failed';
export type ReviewStepState = 'waiting' | 'pending' | 'approved' | 'rejected';
export type Role = 'view' | 'markup' | 'edit' | 'manage';

const VERSION_MOVES: Record<VersionState, VersionState[]> = {
  publishing: ['published'],
  published: ['in_review', 'voided'],
  in_review: ['approved', 'rejected', 'published', 'voided'],
  approved: [],
  rejected: [],
  voided: [],
};

const ISSUE_MOVES: Record<IssueState, IssueState[]> = {
  open: ['answered'],
  answered: ['closed'],
  closed: ['open'],
};

const RFI_MOVES: Record<RfiState, RfiState[]> = {
  draft: ['sent'],
  sent: ['answered'],
  answered: ['closed', 'sent'],
  closed: [],
};

const EXPORT_MOVES: Record<ExportState, ExportState[]> = {
  queued: ['running'],
  running: ['ready', 'failed'],
  ready: [],
  failed: ['running'],
};

export function versionMoveAllowed(from: VersionState, to: VersionState): boolean {
  return VERSION_MOVES[from].includes(to);
}

export function issueMoveAllowed(from: IssueState, to: IssueState): boolean {
  return ISSUE_MOVES[from].includes(to);
}

export function rfiMoveAllowed(from: RfiState, to: RfiState): boolean {
  return RFI_MOVES[from].includes(to);
}

export function exportMoveAllowed(from: ExportState, to: ExportState): boolean {
  return EXPORT_MOVES[from].includes(to);
}

export function versionRefusal(from: VersionState, to: VersionState): string {
  return `A version can\u2019t go from ${from} to ${to}.`;
}

export function issueRefusal(from: IssueState, to: IssueState): string {
  return `An issue can\u2019t go from ${from} to ${to}.`;
}

export function rfiRefusal(from: RfiState, to: RfiState): string {
  return `An RFI can\u2019t go from ${from} to ${to}.`;
}

export function exportRefusal(from: ExportState, to: ExportState): string {
  return `An export can\u2019t go from ${from} to ${to}.`;
}

export function ballInCourtRefusal(user: string): string {
  return `This RFI is with ${user}.`;
}

export function reviewVoidedMessage(replacedByNumber: number): string {
  return `Review voided: version ${replacedByNumber} replaced this one.`;
}

export function replacedByText(number: number): string {
  return `Replaced by version ${number}`;
}

export const ROLE_ORDER: Role[] = ['view', 'markup', 'edit', 'manage'];

export function roleAtLeast(role: Role | null, wanted: Role): boolean {
  if (!role) return false;
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(wanted);
}

export function roleChangeToast(role: Role): string {
  return `Your role is now ${role}.`;
}

export function stampText(kind: 'Approved' | 'Rejected', user: string, at: Date): string {
  return `${kind} by ${user} at ${formatStampTime(at)} UTC`;
}

export function formatStampTime(at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

export function historyLine(user: string, command: string, at: Date): string {
  return `${user} ${command} at ${formatStampTime(at)} UTC`;
}
