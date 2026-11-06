/** Every published sentence the app shows, character for character. */

export const COPY = {
  signInFailed: 'Email or password is incorrect.',
  signInLocked: 'Too many sign-in attempts. Try again later.',
  sessionDialogText: 'Your session ended. Sign in again and we will save your change.',

  passwordChanged: 'Password changed. Your other sessions were signed out.',
  passwordCurrentIncorrect: 'Current password is incorrect.',
  passwordLength: 'Use 12 to 128 characters.',
  passwordUnchanged: 'Choose a password different from your current one.',

  diagramNotFoundHeading: 'Diagram not found',
  diagramNotFoundText:
    "We couldn't find that diagram. It may have been deleted, or you may not have access to it.",
  pageNotFoundHeading: 'Page not found',
  pageNotFoundText: "We couldn't find that page.",

  versionConflict: 'Someone else saved this page. Reload to see their changes.',
  downgradeBanner: 'Your role on this diagram is now viewer. Your last change was not saved.',
  emptyLibrarySearch: 'No shapes match your search.',
  connectPrompt: 'Choose a shape to connect to. Press Escape to cancel.',
  genericFailure: 'Something went wrong. Try again.',
  overlapRefusal: "Zones can't overlap.",

  storageOutage:
    'File storage is unavailable. Diagram edits still save, but exports and imports are paused until it returns.',
  exportReady: 'Export ready.',
  exportFailedRow: 'Export failed. File storage did not confirm the files.',

  importTooLarge: 'This file is too large to import.',
  importWrongType: 'Only diagram XML and SVG files can be imported.',
  importUnsafe: 'This file contains scripts, external entities or unsafe links and was not imported.',
  importInvalidModel: 'This file does not describe a valid diagram.',

  inviteEmailInvalid: 'Enter a valid email address.',
  inviteAlreadyMember: 'This person already has access.',
  invitePending: 'An invitation to this email is already pending.',
  inviteRateLimited: 'Too many invitations sent. Try again later.',

  inviteExpiredHeading: 'This invitation has expired',
  inviteExpiredText: 'Ask the diagram owner to send you a new one.',
  inviteWrongPerson: 'This invitation was sent to a different email address.',
  inviteLookupLimitedHeading: 'Too many attempts',
  inviteLookupLimitedText: 'Wait a few minutes and open the link again.',

  saveStateReadOnly: 'Read only',
  saveStateSaving: 'Saving...',
  saveStateNotSaved: 'Not saved',
  saveStateSaved: 'Saved',
  saveStateUnsaved: 'Unsaved changes',
} as const;

export function connectedAnnouncement(sourceLabel: string, targetLabel: string): string {
  return `Connected ${sourceLabel} to ${targetLabel}.`;
}

export function importingAnnouncement(fileName: string): string {
  return `Importing ${fileName}...`;
}

export function importedAnnouncement(fileName: string): string {
  return `Imported ${fileName} as a new page.`;
}

export function invitationCreated(email: string): string {
  return `Invitation created for ${email}.`;
}

export function invitationDelivered(email: string): string {
  return `Invitation delivered to ${email}.`;
}

export function invitationExpired(email: string): string {
  return `Invitation expired for ${email}.`;
}

export function accessUpdated(email: string): string {
  return `Access updated for ${email}.`;
}

export function accessRemoved(email: string): string {
  return `Removed ${email}.`;
}

export function invitationWithdrawn(email: string): string {
  return `Invitation withdrawn for ${email}.`;
}

function plural(count: number, singular: string, pluralWord: string): string {
  return count === 1 ? singular : pluralWord;
}

/** `<n> systems · <m> crossings`, the zone tally shown in a zone header. */
export function zoneTally(systems: number, crossings: number): string {
  return `${systems} ${plural(systems, 'system', 'systems')} \u00b7 ${crossings} ${plural(
    crossings,
    'crossing',
    'crossings',
  )}`;
}

function tallyTail(systems: number, crossings: number): string {
  return `${systems} ${plural(systems, 'system', 'systems')}, ${crossings} ${plural(
    crossings,
    'crossing',
    'crossings',
  )}.`;
}

export function shapeMovedInto(label: string, zoneName: string, systems: number, crossings: number): string {
  return `${label} moved into ${zoneName}. ${tallyTail(systems, crossings)}`;
}

export function shapeMovedOut(label: string, zoneName: string, systems: number, crossings: number): string {
  return `${label} moved out of ${zoneName}. ${tallyTail(systems, crossings)}`;
}

export function zoneMoved(zoneName: string, systems: number, crossings: number): string {
  return `${zoneName} moved. ${tallyTail(systems, crossings)}`;
}

export function zoneResized(zoneName: string, systems: number, crossings: number): string {
  return `${zoneName} resized. ${tallyTail(systems, crossings)}`;
}

export function zoneUpdated(zoneName: string, systems: number, crossings: number): string {
  return `${zoneName} updated. ${tallyTail(systems, crossings)}`;
}

export function layerBroughtForward(label: string, position: number, total: number): string {
  return `${label} brought forward. Layer ${position} of ${total}.`;
}

export function layerSentBackward(label: string, position: number, total: number): string {
  return `${label} sent backward. Layer ${position} of ${total}.`;
}

export function layerAlreadyFront(label: string): string {
  return `${label} is already at the front.`;
}

export function layerAlreadyBack(label: string): string {
  return `${label} is already at the back.`;
}

export function layerManyForward(count: number): string {
  return `${count} shapes brought forward.`;
}

export function layerManyBackward(count: number): string {
  return `${count} shapes sent backward.`;
}

export function layerManyAlreadyFront(count: number): string {
  return `${count} shapes are already at the front.`;
}

export function layerManyAlreadyBack(count: number): string {
  return `${count} shapes are already at the back.`;
}
