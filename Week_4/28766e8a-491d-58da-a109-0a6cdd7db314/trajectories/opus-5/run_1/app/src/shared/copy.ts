/**
 * Every published string in Linewell, rendered character for character with straight
 * apostrophes, straight double quotes and the ASCII hyphen-minus for negative numbers.
 */

export type AlignSideCopy = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export const copy = {
  movedNotice: (label: string, rerouted: number): string =>
    `Moved ${label}. ${rerouted} ${plural(rerouted, 'connector', 'connectors')} rerouted.`,

  reorderNotice: (name: string, position: number, total: number): string =>
    `Moved ${name} to position ${position} of ${total}.`,

  alignedNotice: (count: number, side: AlignSideCopy): string => `Aligned ${count} shapes ${side}.`,

  distributedNotice: (count: number): string => `Distributed ${count} shapes.`,

  groupedNotice: (count: number): string => `Grouped ${count} shapes.`,
  ungroupedNotice: (count: number): string => `Ungrouped ${count} shapes.`,
  crossLayerGroupRefusal: "Shapes on different layers can't be grouped.",

  lockedNotice: (layerName: string): string => `Layer ${layerName} is locked.`,
  lockedLayerDescription: (layerName: string): string => `On locked layer ${layerName}`,

  rangeMessage: (min: number, max: number): string => `Enter a whole number from ${min} to ${max}.`,

  connectorName: (source: string, target: string): string => `Connector from ${source} to ${target}`,
  blockedConnectorName: (source: string, target: string): string =>
    `Connector from ${source} to ${target}, blocked`,
  connectedNotice: (source: string, target: string): string => `Connected ${source} to ${target}.`,

  joinedNotice: (name: string): string => `${name} joined.`,
  replacedNotice: (name: string, label: string): string =>
    `${name} changed ${label} at the same time. Their edit was kept.`,
  deletedNotice: (label: string, name: string): string =>
    `${label} was deleted by ${name}. Your change was not saved.`,
  roleNotice: "You're now a viewer. Your last change was not saved.",
  cantUndoNotice: (name: string, label: string): string =>
    `Can't undo: ${name} changed ${label} after you.`,

  offlineBanner: (pending: number): string =>
    `Offline. ${pending} ${plural(pending, 'change', 'changes')} waiting to save.`,
  sessionEndedBanner: (pending: number): string =>
    pending === 0
      ? 'Your session ended. Sign in to keep your changes.'
      : `Your session ended. Sign in to keep your changes. ${pending} ${plural(pending, 'change', 'changes')} waiting to save.`,
  savedBanner: 'All changes saved.',

  viewOnlyBanner: (ownerName: string): string => `View only. Ask ${ownerName} for edit access.`,
  previewBanner: (versionName: string): string =>
    `Previewing ${versionName}. Restore it or go back to the latest.`,

  versionSavedNotice: (versionName: string): string => `Saved ${versionName}.`,
  restorePending: (versionName: string): string => `Restoring ${versionName}...`,
  restoredNotice: (name: string, versionName: string): string => `${name} restored ${versionName}.`,

  exportPending: (pageName: string): string => `Exporting ${pageName}...`,
  exportReady: 'Export ready.',
  exportPausedBanner: 'Exports are paused: storage is unavailable. Editing still works.',

  invitePending: 'Sending invite...',
  inviteEmailedNotice: (email: string): string => `Invite emailed to ${email}.`,
  mailOutageBanner: 'Email is unavailable. The invite is saved; use Resend when email is back.',

  emptyPageText: 'This page is empty. Add a shape from the toolbar or press R.',
  emptyDiagramList: 'No diagrams yet. Create one to start drawing.',

  notFoundHeading: 'Diagram not found',
  notFoundText: "This diagram doesn't exist or you don't have access to it.",

  signInError: 'Email or password is incorrect.',

  fieldErrors: {
    name: 'Enter your name.',
    email: 'Enter an email address.',
    password: 'Use at least 10 characters.',
    emailTaken: 'An account with this email already exists.',
    title: 'Enter a title.',
    controlCharacters: 'Remove line breaks and control characters.',
  },

  inviteSubject: (inviterName: string, diagramTitle: string, role: 'editor' | 'viewer'): string =>
    `${inviterName} shared "${diagramTitle}" with you as ${role === 'editor' ? 'an editor' : 'a viewer'}`,
  mentionSubject: (name: string, diagramTitle: string): string =>
    `${name} mentioned you on "${diagramTitle}"`,
} as const;

/** The invite status texts shown in the Share dialog rows. */
export const inviteStatusText = {
  active: 'Active',
  emailed: 'Invited',
  email_not_sent: 'Email not sent',
  expired: 'Expired',
} as const;

/** Outline item texts. */
export const outlineCopy = {
  page: (name: string, shapes: number, connectors: number): string =>
    `${name}, ${shapes} ${plural(shapes, 'shape', 'shapes')}, ${connectors} ${plural(connectors, 'connector', 'connectors')}`,
  layer: (name: string, locked: boolean, shapes: number): string =>
    `${name} layer, ${locked ? 'locked, ' : ''}${shapes} ${plural(shapes, 'shape', 'shapes')}`,
  group: (members: number): string => `Group of ${members} shapes`,
  shape: (label: string, kind: string, targets: readonly string[], sources: readonly string[]): string => {
    const parts = [`${label}, ${kind}`];
    if (targets.length === 0 && sources.length === 0) return `${parts[0]}, not connected`;
    if (targets.length > 0) parts.push(`connected to ${joinLabels(targets)}`);
    if (sources.length > 0) parts.push(`connected from ${joinLabels(sources)}`);
    return parts.join(', ');
  },
} as const;

/**
 * One label stands alone; two are joined as `<a> and <b>`; three or more read
 * `<a>, <b> and <c>`, with no comma before `and`.
 */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  const head = labels.slice(0, -1);
  const tail = labels[labels.length - 1] ?? '';
  if (head.length === 1) return `${head[0]} and ${tail}`;
  return `${head.join(', ')} and ${tail}`;
}

/** `Group of <n> shapes` is also the group's accessible name on the canvas. */
export function groupName(members: number): string {
  return `Group of ${members} shapes`;
}

/** A version's display name is its name, or `Version <number>` when it has none. */
export function versionDisplayName(name: string | null, number: number): string {
  return name !== null && name.length > 0 ? name : `Version ${number}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `<display name> · <author name> · <d Mon yyyy, HH:mm> UTC` */
export function versionListText(displayName: string, authorName: string, createdAt: string): string {
  const at = new Date(createdAt);
  const day = at.getUTCDate();
  const month = MONTHS[at.getUTCMonth()] ?? '';
  const year = at.getUTCFullYear();
  const hours = String(at.getUTCHours()).padStart(2, '0');
  const minutes = String(at.getUTCMinutes()).padStart(2, '0');
  return `${displayName} · ${authorName} · ${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}
