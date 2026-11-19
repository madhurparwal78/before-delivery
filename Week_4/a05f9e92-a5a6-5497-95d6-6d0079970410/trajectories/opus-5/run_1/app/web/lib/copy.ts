/**
 * Every published string, in one place, so visible copy and the announcement
 * match character for character.
 */

export const copy = {
  tagline: 'One person, one organisation, every promise kept on its own clock.',
  openDesk: 'Open your desk',

  signingIn: 'Signing in...',
  signInFailed: 'That username and password do not match.',

  saving: 'Saving...',
  saved: (number: string): string => `Saved ${number}.`,
  problems: (n: number): string => `${n} problems to fix before saving.`,
  conflict: (fieldLabel: string, displayName: string): string =>
    `Conflict on ${fieldLabel}: ${displayName} saved a newer value.`,

  moving: 'Moving...',
  moved: (number: string, stateLabel: string): string => `${number} moved to ${stateLabel}.`,

  noteAdded: 'Note added.',

  slaPaused: 'SLA paused: on hold',
  slaResumed: 'SLA resumed',
  slaThreshold: (percent: number, name: string): string => `SLA at ${percent} percent: ${name}`,
  slaBreached: (name: string): string => `SLA breached: ${name}`,

  requesterStateChange: (number: string, stateLabel: string): string =>
    `Your request ${number} is now ${stateLabel}.`,

  submitting: 'Submitting...',
  requestSubmitted: (number: string, n: number): string =>
    `Request ${number} submitted with ${n} items.`,

  voteRecorded: (decision: 'approve' | 'reject', number: string): string =>
    `Vote recorded: ${decision} on ${number}.`,
  approvingSwipe: (number: string): string => `Approving ${number}. Undo within 5 seconds.`,
  rejectingSwipe: (number: string): string => `Rejecting ${number}. Undo within 5 seconds.`,
  voteUndone: 'Vote undone.',
  approvalReset: (number: string): string => `${number} changed and needs a new vote.`,

  pageAcknowledged: 'Page acknowledged.',

  bulkSummary: (ok: number, failed: number): string => `${ok} updated, ${failed} not updated.`,
  bulkRowOk: (number: string): string => `${number} updated`,
  bulkRowFailed: (number: string, reason: string): string => `${number} not updated: ${reason}`,

  newRecords: (n: number): string => (n === 1 ? '1 new record' : `${n} new records`),

  attachmentUploading: 'uploading',
  attachmentAttached: (name: string): string => `${name} attached.`,
  attachmentQueued: (name: string): string => `${name} is queued until file storage returns.`,

  importChecking: 'Checking import...',
  importChecked: (c: number, u: number, x: number, e: number): string =>
    `Import checked: ${c} to create, ${u} to update, ${x} unchanged, ${e} with errors.`,
  importing: 'Importing...',
  importFinished: (c: number, u: number, x: number, e: number): string =>
    `Import finished: ${c} created, ${u} updated, ${x} unchanged, ${e} failed.`,

  exportProgress: (done: number, total: number): string => `${done} of ${total} rows`,
  exportComplete: (n: number): string => `Export complete: ${n} rows.`,
  exportFailed: 'Export failed: file storage is unreachable.',

  setExporting: 'Exporting...',
  setExported: (number: string): string => `Set ${number} exported.`,
  setCommitting: 'Committing...',
  setCommitted: (number: string, n: number): string => `Set ${number} committed: ${n} items applied.`,
  setBackingOut: 'Backing out...',
  setBackedOut: (number: string): string => `Set ${number} backed out.`,

  publishing: 'Publishing...',
  versionPublished: (n: number): string => `Version ${n} published.`,
  triggerStaysFirst: 'The trigger stays first.',

  relayReduced: (n: number, item: string): string => `${n} people affected by ${item}.`,
  accessChanged: 'Your access changed.',

  storageDesk:
    'File storage is unreachable. Ticket work continues; uploads are queued and exports will retry when storage returns.',
  storagePortal:
    'Attachments are paused while file storage is unreachable. Your request still goes through.',
  impersonating: (displayName: string, username: string): string =>
    `Impersonating ${displayName} (${username}). Everything you do is recorded.`,
  majorProposed: (item: string): string => `Major incident proposed for ${item}.`,

  emptyQueue: (queue: string): string => `Nothing waiting in ${queue}.`,
  emptyQueueButton: 'Show all open incidents',
  noMatches: 'No records match this filter.',
  noMatchesButton: 'Clear filter',
  noArticles: (query: string): string => `No articles match "${query}".`,
  noArticlesButton: 'Report a fault',
  emptyInbox: 'Your inbox is empty.',
  emptyInboxButton: 'Back to your desk',
  noVotes: 'No votes waiting for you.',
  noVotesButton: 'Open changes',
  loading: (subject: string): string => `Loading ${subject}...`,
  loadingButton: 'Cancel',
  loadError: 'Switchyard could not load this. Try again.',
  loadErrorButton: 'Try again',
  notFound: "That page isn't on the switchyard.",
  notFoundButton: 'Back to your desk',

  countRule: (a: number, r: number, w: number, n: number, m: number): string =>
    `Approve ${a}, reject ${r}, waiting ${w}. Needs ${n} of ${m}.`,
  weightedRule: (a: number, r: number, w: number, n: number, t: number): string =>
    `Approve weight ${a}, reject weight ${r}, waiting weight ${w}. Needs ${n} of ${t}.`,
  closedApproved: 'Closed: approved',
  closedRejected: 'Closed: rejected',
} as const;

/** The published duration form `<H>:<MM>:<SS>`, hours unbounded. */
export function durationText(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface SlaView {
  readonly id: number;
  readonly definition: string;
  readonly stage: 'in_progress' | 'paused' | 'completed' | 'cancelled';
  readonly remaining_seconds: number;
  readonly paused_seconds: number;
  readonly percent: number;
  readonly breached: boolean;
  readonly ticking: boolean;
  readonly next_change_at: string | null;
  readonly server_time: string;
  readonly target_seconds: number;
  readonly elapsed_seconds: number;
}

/** The countdown copy used on forms, queue rows and the portal. */
export function countdownText(sla: SlaView, shownRemaining: number): string {
  if (sla.stage === 'completed') return sla.breached ? 'Missed' : 'Met';
  if (sla.stage === 'paused') return `Paused at ${durationText(shownRemaining)} left`;
  if (shownRemaining < 0) return `Breached by ${durationText(-shownRemaining)}`;
  return `${durationText(shownRemaining)} left`;
}

export function pausedForText(sla: SlaView): string {
  return `Paused for ${durationText(sla.paused_seconds)}`;
}

export function percentText(percent: number): string {
  return `${percent} percent`;
}
