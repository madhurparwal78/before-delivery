import type { CardStatus } from './types';

export const COPY = {
  emptyList: 'Nothing here yet. Add a card when something needs doing.',
  noLists: 'This board has no lists yet. Add a list to get started.',
  cardNotFoundHeading: "We couldn't find that card",
  cardNotFoundBody: "It may have been archived, or it isn't shared with you.",
  boardNotFoundHeading: "We couldn't find that board",
  boardNotFoundBody: "It may have been made private, or it isn't shared with you.",
  livePaused:
    "Live updates are paused. Your changes still save, but others' changes won't appear until live updates are back.",
  storageDown: 'Attachments are unavailable right now. Cards, moves and checklists still work.',
  signedOut: "You've been signed out. Sign in again to continue.",
  badCredentials: "That email and password don't match.",
  passwordChanged: 'Password changed. Every other session is now signed out.',
  wrongCurrentPassword: "That isn't your current password.",
  passwordLength: 'Use 12 to 200 characters.',
  boardNameRequired: 'Give the board a name.',
  boardNameTooLong: 'Keep the name to 60 characters or fewer.',
  listNameRequired: 'Give the list a name.',
  listNameTooLong: 'Keep the name to 40 characters or fewer.',
  cardTitleRequired: 'Give the card a title.',
  cardTitleTooLong: 'Keep the title to 120 characters or fewer.',
  checklistTextRequired: 'Give the item some text.',
  lockedEdit: 'You can no longer edit this card.',
  lastAdmin: 'A board needs at least one admin.',
  genericFailure: 'Something went wrong. Try again.',
  searchLimit: 'Search is limited to 100 characters.',
  liveBack: 'Live updates are back.',
  deleteBlockedByStorage: "Couldn't delete while attachments are unavailable. Try again shortly.",
} as const;

export const ANNOUNCE = {
  keyboardLift: (title: string, list: string, n: number, total: number) =>
    `Picked up ${title} in ${list}, position ${n} of ${total}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
  pointerLift: (title: string) => `Picked up ${title}.`,
  over: (title: string, list: string, n: number, total: number) =>
    `${title} is over ${list}, position ${n} of ${total}.`,
  moved: (title: string, list: string, n: number, total: number) =>
    `Moved ${title} to ${list}, position ${n} of ${total}.`,
  cancelled: (title: string, list: string, n: number, total: number) =>
    `Move cancelled. ${title} is back in ${list}, position ${n} of ${total}.`,
  cancelledGone: (title: string) => `Move cancelled. ${title} is no longer on this board.`,
  remoteMove: (name: string, title: string, list: string, n: number, total: number) =>
    `${name} moved ${title} to ${list}, position ${n} of ${total}.`,
  staleMoved: (name: string, title: string, list: string, n: number, total: number) =>
    `${name} moved ${title} first. It's back in ${list}, position ${n} of ${total}.`,
  staleEdited: (name: string, title: string, list: string, n: number, total: number) =>
    `${name} edited ${title} first. It's back in ${list}, position ${n} of ${total}.`,
  notShared: (title: string) => `${title} is no longer shared with you.`,
  created: (title: string, list: string) => `Added ${title} to ${list}.`,
  saved: (title: string) => `Saved changes to ${title}.`,
  status: (title: string, status: CardStatus) =>
    status === 'done' ? `Marked ${title} done.` : status === 'open' ? `Reopened ${title}.` : `Archived ${title}.`,
  checked: (item: string) => `Checked off ${item}.`,
  unchecked: (item: string) => `Unchecked ${item}.`,
  itemAdded: (item: string) => `Added ${item} to the checklist.`,
  attached: (filename: string) => `Attached ${filename}.`,
} as const;

export const SEARCH_STATUS = {
  none: (query: string) => `No cards match "${query}".`,
  one: (query: string) => `1 card matches "${query}".`,
  many: (count: number, query: string) => `${count} cards match "${query}".`,
  capped: (count: number, query: string) => `Showing 50 of ${count} cards that match "${query}".`,
} as const;

/** `<filename>` shows any control character as a question mark. */
export function displayFilename(filename: string): string {
  return [...filename]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? '?' : character;
    })
    .join('');
}

export const uploadCopy = {
  pending: (filename: string) => `Uploading ${filename}…`,
  tooLarge: (filename: string) => `${filename} is too large. Files can be up to 10,000,000 bytes.`,
  badType: (filename: string) => `${filename} isn't a PDF, JPEG or PNG.`,
  badName: (filename: string) => `${filename} has a name that can't be stored.`,
  unavailable: (filename: string) => `Couldn't attach ${filename}. Attachments are unavailable right now.`,
  downloadUnavailable: (filename: string) => `Couldn't open ${filename}. Attachments are unavailable right now.`,
} as const;

export const accessChangedCopy = (role: 'Admin' | 'Member' | 'Observer') => `Your access to this board is now ${role}.`;

export const countCopy = (count: number) => (count === 1 ? '1 card' : `${count} cards`);
export const openCountCopy = (count: number) => (count === 1 ? '1 open' : `${count} open`);
