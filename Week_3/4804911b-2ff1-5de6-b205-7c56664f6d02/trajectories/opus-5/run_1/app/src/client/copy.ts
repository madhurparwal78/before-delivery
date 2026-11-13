import { dayMonthYear } from './format.js';

/** Every published sentence, character for character. */
export const copy = {
  printOutage: 'Printing is down. The prices on this page are still correct.',
  lostPrintRequest: "Print request didn't reach the server. Try again.",
  messageOutage: 'Stockist messages are queued. Nothing has been lost.',
  workOutage: 'Background work is queued. Nothing has been lost.',
  workSetAside: 'A broken job was set aside. No notice was affected.',
  storageOutage: 'Stored copies are unavailable right now. The prices on this page are still correct.',
  expiredLink: 'This link has expired. Getting a fresh one.',
  searchBehind: 'Search is catching up. Recent changes may be missing.',
  searchDown: 'Search is down. Exact codes still work.',
  noMatch: 'No pack matches that.',
  unknownBatch: "We can't find that batch. Check the code printed near the best-before date.",
  unknownPack: "This pack isn't in the programme.",
  noSticker: 'No sticker on this pack. The printed price is the price.',
  pastDate: "This pack is past its best-before date. Please don't drink it.",
  staleDraft: 'This draft changed in another tab. Reload to see it.',
  closedWrapperWindow: 'No notice allows old wrappers for this pack on that date.',
  badSheetQuoting: 'This sheet has a broken quoted field.',
  rotationUnavailable: 'Rotation needs the message service. Try again shortly.',
  rotationInProgress: 'This secret is already being rotated.',
  lostRemoval: "Removal didn't reach the server. Try again.",
  nothingToRecover: 'Nothing on this endpoint is waiting for recovery.',
  previewClear: 'Ready to publish.',
  endedSession: 'Your session has ended. Sign in again.',
  workKept: 'Your unsaved work was kept. Nothing has been sent.',
  confirmWarning: "This can't be undone. There is no way back to draft.",
  noStickerPacks: 'No pack takes a sticker.',
  unsavedDraft: 'Save this draft first. The notice would publish its saved values.',
  stillBeingPrinted: 'This notice is still being printed.',
  badCredentials: "That email and password don't match.",
  heroStory:
    "Nashik's Vasant Talkies bottled its interval soda in the lobby, and the house still prints every price where you can read it.",
  legalLine: 'Vasant Talkies Drinks is an invented house. Every price here is invented.',
} as const;

export function newDaySentence(today: string): string {
  return `The house date has changed. Prices here are for ${dayMonthYear(today)}.`;
}

export function dayReadSentence(today: string): string {
  return `Prices read for ${dayMonthYear(today)}.`;
}

export function waitMessage(seconds: number): string {
  return `Too many tries. Wait ${seconds} seconds and try again.`;
}

export function waitTimeSentence(seconds: number): string {
  return seconds === 1 ? '1 second left.' : `${seconds} seconds left.`;
}

export function openRowsSentence(count: number): string {
  return count === 1 ? '1 row open.' : `${count} rows open.`;
}

export function packsFoundSentence(count: number): string {
  return count === 1 ? '1 pack found.' : `${count} packs found.`;
}

export function countsLine(counts: {
  drinks: number;
  skus: number;
  notices: number;
  scheduledRevisions: number;
}): string {
  return `Drinks: ${counts.drinks}. Packs: ${counts.skus}. Notices: ${counts.notices}. Scheduled revisions: ${counts.scheduledRevisions}.`;
}

export function printChangeSentence(number: string, version: number, state: 'printable' | 'failed'): string {
  return `Notice ${number} version ${version} is now ${state === 'printable' ? 'Printable' : 'Print failed'}.`;
}

export function deliveryChangeSentence(eventId: string, label: string): string {
  return `Delivery ${eventId} is now ${label}.`;
}

export const slides = {
  loading: { line: 'REEL CHANGE', note: 'One moment while the next reel is threaded.' },
  notFound: { line: 'REEL MISSING', note: "This page isn't in the programme." },
  noSheets: { line: 'CALL SHEET EMPTY', note: "Import the plant's price sheet to begin." },
  noDrafts: { line: 'NOTHING IN THE CAN', note: 'Draft a notice from a settled sheet.' },
  noEndpoints: { line: 'NO SCREEN BOOKED', note: 'Save an endpoint to receive price messages.' },
  noDeliveries: { line: 'NOTHING ON THE REEL', note: 'No messages have gone to your endpoints yet.' },
} as const;
