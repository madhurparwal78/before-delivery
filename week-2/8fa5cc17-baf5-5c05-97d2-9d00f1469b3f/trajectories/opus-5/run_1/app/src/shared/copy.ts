/** Exact copy from the brief's feedback states, with one home. */

export const COPY = {
  savePending: 'Saving',
  saveDone: 'Saved',
  saveFailed: 'Not saved. Check your connection and try again.',
  editConflict: 'This block changed on another device.',
  noBlocksMatch: 'No blocks match.',
  quoteRefused: "That block couldn't be quoted.",
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  undoConflict: "Can't undo: that text changed on another device.",
  redoConflict: "Can't redo: that text changed on another device.",
  undoGoneOrigin: "Can't undo: the quoted block no longer exists.",
  redoGoneOrigin: "Can't redo: the quoted block no longer exists.",
  restoreStale: 'This block changed since you opened its history.',
  boardMoveRefused: "Those cards couldn't be moved.",
  blockMoveRefused: "That block couldn't be moved.",
  emptyDailyNote: "Nothing written today. Start with a line from what you're reading.",
  signInWrong: "That email and password don't match.",
  signInLocked: 'Too many sign-in attempts. Wait a while, then try again.',
  signedOutElsewhere: "You've been signed out on this device.",
  passwordChanged: 'Password changed. Your other devices are signed out.',
  deviceAlreadySignedOut: 'That device is already signed out.',
  linkRevoked: 'Link revoked. Anyone using it now sees that it is no longer active.',
  linkRegenerated: 'New link created. The old link no longer works.',
  scopeLinkInactive: 'That share link is no longer active.',
  uploadTooLarge: 'That file is too large to attach.',
  uploadWrongType: 'Attach an image (PNG, JPEG, GIF, WebP) or a PDF.',
  uploadDuringOutage: 'Storage is unavailable, so this file was not attached.',
  storageBanner: 'Attachments are unavailable right now. Your writing is still saved.',
  attachmentDuringOutage: "This attachment can't be shown while storage is unavailable.",
  syncPaused: 'Live updates paused. Reconnecting.',
  syncLive: 'Live',
  notFound: "We can't find that note.",
  shareInactiveHeading: 'This link is no longer active',
  shareInactiveBody: 'Ask the person who shared it for a new link.',
  shareUnknownHeading: 'This link is not recognised',
  shareOutOfScope: 'This note is not part of this share.',
  shareQuoteOutOfScope: 'Quoted from a note outside this share.',
} as const;

export function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

export function backlinksPhrase(count: number): string {
  return `${count} ${plural(count, 'backlink', 'backlinks')}`;
}

export function matchingBlocksCopy(count: number): string {
  return count === 0 ? COPY.noBlocksMatch : `${count} ${plural(count, 'matching block', 'matching blocks')}`;
}

export function paletteStatusCopy(commands: number, notes: number): string {
  return `${commands} ${plural(commands, 'command', 'commands')}, ${notes} ${plural(notes, 'note', 'notes')}`;
}

export function quotedCopy(originTitle: string, count: number): string {
  return `Quoted from ${originTitle}. ${backlinksPhrase(count)}.`;
}

export function quoteRemovedCopy(originTitle: string, count: number): string {
  return `Quote removed. ${originTitle} has ${backlinksPhrase(count)}.`;
}

export function undoneCopy(step: string): string {
  return `Undid ${step}.`;
}

export function redoneCopy(step: string): string {
  return `Redid ${step}.`;
}

export function restoredCopy(version: number, newVersion: number): string {
  return `Restored version ${version}. Saved as version ${newVersion}.`;
}

export function boardMovedOneCopy(title: string, x: number, y: number): string {
  return `Moved ${title} to x ${x}, y ${y}.`;
}

export function boardMovedManyCopy(count: number): string {
  return `Moved ${count} ${plural(count, 'card', 'cards')}.`;
}

export function blockMovedCopy(dateHeading: string): string {
  return `Moved block to ${dateHeading}.`;
}

export function pinnedCopy(title: string): string {
  return `Pinned ${title}.`;
}

export function unpinnedCopy(title: string): string {
  return `Unpinned ${title}.`;
}

export function blockQuotedElsewhereCopy(count: number): string {
  return `This block is quoted in ${count} ${plural(count, 'place', 'places')}. Remove those quotes first.`;
}

export function deleteNoteCopy(count: number): string {
  return `Deleting removes ${count} ${plural(count, 'quote', 'quotes')} of its blocks from other notes.`;
}

export function capturedNewDayCopy(dateHeading: string): string {
  return `Saved to ${dateHeading}, the new day on your home clock.`;
}

export function deviceSignedOutCopy(label: string): string {
  return `Signed out ${label}.`;
}

export function homeClockSavedCopy(zone: string): string {
  return `Home clock set to ${zone}. Today's note now follows it.`;
}

export function themeSavedCopy(theme: string): string {
  return `Theme set to ${theme}.`;
}

export function linkCreatedCopy(expires: string): string {
  return `Link created. It stops working at ${expires}.`;
}

export function uploadPendingCopy(filename: string): string {
  return `Uploading ${filename}`;
}

export function uploadDoneCopy(filename: string): string {
  return `${filename} saved.`;
}

export function uploadAttachedCopy(filename: string, objectTitle: string): string {
  return `${filename} attached to ${objectTitle}.`;
}

export function heatCaption(count: number): string {
  return `${count} ${plural(count, 'block', 'blocks')}`;
}
