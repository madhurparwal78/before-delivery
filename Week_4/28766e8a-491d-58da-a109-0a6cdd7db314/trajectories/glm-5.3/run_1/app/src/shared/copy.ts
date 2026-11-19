export function movedNotice(label: string, reroutedCount: number): string {
  const conn = reroutedCount === 1
    ? '1 connector rerouted.'
    : `${reroutedCount} connectors rerouted.`;
  return `Moved ${label}. ${conn}`;
}

export function reorderNotice(name: string, position: number, total: number): string {
  return `Moved ${name} to position ${position} of ${total}.`;
}

export function alignedNotice(count: number, side: 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'): string {
  return `Aligned ${count} shapes ${side}.`;
}

export function distributedNotice(count: number): string {
  return `Distributed ${count} shapes.`;
}

export function groupedNotice(count: number): string {
  return `Grouped ${count} shapes.`;
}

export function ungroupedNotice(count: number): string {
  return `Ungrouped ${count} shapes.`;
}

export const crossLayerGroupRefusal = "Shapes on different layers can't be grouped.";

export function lockedNotice(layerName: string): string {
  return `Layer ${layerName} is locked.`;
}

export function lockedLayerDescription(layerName: string): string {
  return `On locked layer ${layerName}`;
}

export function rangeMessage(min: number, max: number): string {
  return `Enter a whole number from ${min} to ${max}.`;
}

export function connectorName(sourceLabel: string, targetLabel: string): string {
  return `Connector from ${sourceLabel} to ${targetLabel}`;
}

export function blockedConnectorName(sourceLabel: string, targetLabel: string): string {
  return `Connector from ${sourceLabel} to ${targetLabel}, blocked`;
}

export function connectedNotice(sourceLabel: string, targetLabel: string): string {
  return `Connected ${sourceLabel} to ${targetLabel}.`;
}

export function joinedNotice(name: string): string {
  return `${name} joined.`;
}

export function replacedNotice(name: string, label: string): string {
  return `${name} changed ${label} at the same time. Their edit was kept.`;
}

export function deletedNotice(label: string, name: string): string {
  return `${label} was deleted by ${name}. Your change was not saved.`;
}

export const roleNotice = "You're now a viewer. Your last change was not saved.";

export function cantUndoNotice(name: string, label: string): string {
  return `Can't undo: ${name} changed ${label} after you.`;
}

export function waitingChanges(count: number): string {
  return count === 1 ? '1 change waiting to save.' : `${count} changes waiting to save.`;
}

export function offlineBanner(count: number): string {
  return `Offline. ${waitingChanges(count)}`;
}

export function sessionEndedBanner(count: number): string {
  return `Your session ended. Sign in to keep your changes. ${waitingChanges(count)}`;
}

export const savedBanner = 'All changes saved.';

export function viewOnlyBanner(ownerName: string): string {
  return `View only. Ask ${ownerName} for edit access.`;
}

export function previewBanner(versionName: string): string {
  return `Previewing ${versionName}. Restore it or go back to the latest.`;
}

export function versionSavedNotice(versionName: string): string {
  return `Saved ${versionName}.`;
}

export function restorePending(versionName: string): string {
  return `Restoring ${versionName}...`;
}

export function restoredNotice(name: string, versionName: string): string {
  return `${name} restored ${versionName}.`;
}

export function exportPending(pageName: string): string {
  return `Exporting ${pageName}...`;
}

export const exportReady = 'Export ready.';

export const exportPausedBanner = 'Exports are paused: storage is unavailable. Editing still works.';

export const invitePending = 'Sending invite...';

export function inviteEmailedNotice(email: string): string {
  return `Invite emailed to ${email}.`;
}

export const inviteStatusActive = 'Active';
export const inviteStatusInvited = 'Invited';
export const inviteStatusEmailNotSent = 'Email not sent';
export const inviteStatusExpired = 'Expired';

export const mailOutageBanner = 'Email is unavailable. The invite is saved; use Resend when email is back.';

export const emptyPageText = 'This page is empty. Add a shape from the toolbar or press R.';

export const emptyDiagramList = 'No diagrams yet. Create one to start drawing.';

export const notFoundHeading = 'Diagram not found';
export const notFoundText = "This diagram doesn't exist or you don't have access to it.";

export const signInError = 'Email or password is incorrect.';

export const fieldNameError = 'Enter your name.';
export const fieldEmailError = 'Enter an email address.';
export const fieldPasswordError = 'Use at least 10 characters.';
export const fieldTakenEmailError = 'An account with this email already exists.';
export const fieldTitleError = 'Enter a title.';
export const fieldControlCharsError = 'Remove line breaks and control characters.';

export function inviteEmailSubject(inviterName: string, diagramTitle: string, role: 'editor' | 'viewer'): string {
  return `${inviterName} shared "${diagramTitle}" with you as ${role === 'editor' ? 'an editor' : 'a viewer'}`;
}

export function mentionEmailSubject(name: string, diagramTitle: string): string {
  return `${name} mentioned you on "${diagramTitle}"`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatUtc(date: Date): string {
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()]!;
  const year = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

export function historyListText(displayName: string, authorName: string, date: Date): string {
  return `${displayName} · ${authorName} · ${formatUtc(date)} UTC`;
}

/** A mention run: @ then letters, digits and . _ % + - @, with a trailing . dropped. */
export function mentionCandidates(text: string): string[] {
  const matches = text.match(/@[A-Za-z0-9._%+-@]*/g) ?? [];
  return matches.map((m) => {
    let value = m.slice(1);
    while (value.endsWith('.')) value = value.slice(0, -1);
    return value;
  }).filter((v) => v.length > 0);
}

export function pageStripText(pageName: string, n: number, total: number): string {
  return `${pageName} · ${n} of ${total}`;
}

export function multiLabel(count: number): string {
  return `${count} shapes`;
}

export function versionDisplayName(name: string | null, number: number): string {
  return name ?? `Version ${number}`;
}
