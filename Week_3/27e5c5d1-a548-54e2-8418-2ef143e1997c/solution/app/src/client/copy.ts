import { SEARCH_RESULT_LIMIT } from '../shared/search.ts';
import type { Role } from '../shared/types.ts';
import { CONTROL_CHARACTERS } from '../shared/text.ts';

/** Published copy, character for character (all straight quotes and apostrophes). */
export const COPY = {
  emptyList: 'Nothing here yet. Add a card when something needs doing.',
  noLists: 'This board has no lists yet. Add a list to get started.',
  signedOut: "You've been signed out. Sign in again to continue.",
  badLogin: "That email and password don't match.",
  boardGoneTitle: "We couldn't find that board",
  boardGoneBody: "It may have been made private, or it isn't shared with you.",
  cardGoneTitle: "We couldn't find that card",
  cardGoneBody: "It may have been archived, or it isn't shared with you.",
  livePaused: "Live updates are paused. Your changes still save, but others' changes won't appear until live updates are back.",
  storageDown: 'Attachments are unavailable right now. Cards, moves and checklists still work.',
  liveBack: 'Live updates are back.',
  wentWrong: 'Something went wrong. Try again.',
  lockedEdit: 'You can no longer edit this card.',
  lastAdmin: 'A board needs at least one admin.',
  passwordChanged: 'Password changed. Every other session is now signed out.',
  searchLimit: 'Search is limited to 100 characters.',
  deleteBlocked: "Couldn't delete while attachments are unavailable. Try again shortly.",
} as const;

export const KEY_MAP: readonly (readonly [string, string, string])[] = [
  ['Space', 'focus on a card button', 'lifts the card'],
  ['Up Arrow / Down Arrow', 'card lifted', 'one position up or down in the current list, stopping at the ends'],
  ['Left Arrow / Right Arrow', 'card lifted', 'to the previous or next list, keeping the same position number when it exists, otherwise last'],
  ['Space or Enter', 'card lifted', 'drops the card where it is'],
  ['Escape', 'card lifted', 'cancels; the card returns to where it started'],
  ['Tab', 'card lifted', 'cancels, then moves focus as usual'],
  ['Enter', 'focus on a card button, not lifted', 'opens the card dialog'],
  ['?', 'focus on any control in the board area that is not a text field', 'opens the Keyboard shortcuts dialog'],
  ['Escape', 'a dialog, sheet or menu is open', 'closes it and returns focus to the control that opened it'],
];

export const roleName = (role: Role): string => role.charAt(0).toUpperCase() + role.slice(1);

export const sentences = {
  lift: (title: string, list: string, n: number, total: number): string =>
    `Picked up ${title} in ${list}, position ${n} of ${total}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
  pointerLift: (title: string): string => `Picked up ${title}.`,
  over: (title: string, list: string, n: number, total: number): string => `${title} is over ${list}, position ${n} of ${total}.`,
  moved: (title: string, list: string, n: number, total: number): string => `Moved ${title} to ${list}, position ${n} of ${total}.`,
  cancel: (title: string, list: string, n: number, total: number): string =>
    `Move cancelled. ${title} is back in ${list}, position ${n} of ${total}.`,
  cancelRemoved: (title: string): string => `Move cancelled. ${title} is no longer on this board.`,
  remote: (name: string, title: string, list: string, n: number, total: number): string =>
    `${name} moved ${title} to ${list}, position ${n} of ${total}.`,
  stale: (name: string, change: 'moved' | 'edited', title: string, list: string, n: number, total: number): string =>
    `${name} ${change} ${title} first. It's back in ${list}, position ${n} of ${total}.`,
  notShared: (title: string): string => `${title} is no longer shared with you.`,
  created: (title: string, list: string): string => `Added ${title} to ${list}.`,
  saved: (title: string): string => `Saved changes to ${title}.`,
  done: (title: string): string => `Marked ${title} done.`,
  reopened: (title: string): string => `Reopened ${title}.`,
  archived: (title: string): string => `Archived ${title}.`,
  checked: (item: string): string => `Checked off ${item}.`,
  unchecked: (item: string): string => `Unchecked ${item}.`,
  itemAdded: (item: string): string => `Added ${item} to the checklist.`,
  attached: (filename: string): string => `Attached ${filename}.`,
  access: (role: string): string => `Your access to this board is now ${role}.`,
  search: (count: number, total: number, query: string): string =>
    total > SEARCH_RESULT_LIMIT ? `Showing ${SEARCH_RESULT_LIMIT} of ${total} cards that match "${query}".`
      : count === 0 ? `No cards match "${query}".`
      : count === 1 ? `1 card matches "${query}".`
      : `${count} cards match "${query}".`,
};

export const countText = (n: number): string => (n === 1 ? '1 card' : `${n} cards`);
export const openText = (n: number): string => `${n} open`;

/** Any control character in a file name is shown as `?`. */
export const displayName = (filename: string): string => filename.replace(new RegExp(CONTROL_CHARACTERS.source, 'g'), '?');
