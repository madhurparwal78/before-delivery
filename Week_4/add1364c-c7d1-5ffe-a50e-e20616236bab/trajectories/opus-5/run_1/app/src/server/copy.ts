/** Published copy that the server sends, kept beside the rules that print it. */

import { formatOfficeDate, formatOfficeStamp, type OfficeDate, type OfficeOffset } from './officeTime.js';

export const copy = {
  badCredentials: "That username and password don't match.",
  accountDisabled: 'This sign-in is switched off. Ask the office manager.',
  signInUnavailable: 'Sign-in is unavailable right now. Try again in a minute.',
  signInLocked: (reopensAt: Date): string =>
    `Too many tries. Sign-in for this username reopens at ${formatOfficeStamp(reopensAt)}.`,
  sessionEnded: 'Your reveal session has ended.',
  signedOut: 'Sign in again.',
  turnRequired: 'This login is past its 14-day leeway. Turn it before revealing.',
  ruleChanged: 'This rule changed since you opened it. Reload it and try again.',
  ruleNotSignable: "This rule can't be signed now.",
  effectiveDatePast: 'Pick a date after today.',
  minimumLength: (vault: string, minLength: number): string => `${vault} needs at least ${minLength} characters.`,
  alreadyLeft: (name: string): string => `${name} has already left.`,
  rotationExists: 'This login already has a rotation.',
  lineDecided: 'This line is already decided.',
  linesUndecided: 'Decide every line before signing off.',
  reviewSignedOff: 'This review is signed off.',
  billingUnreachable:
    "Billing can't be reached. Seat changes wait here and are not counted until billing confirms them.",
  breachFeedUnreachable: (lastGoodCheckAt: Date | null): string =>
    lastGoodCheckAt === null
      ? "The breach feed can't be reached. No check has succeeded yet."
      : `The breach feed can't be reached. Showing the last good check from ${formatOfficeStamp(lastGoodCheckAt)}.`,
  tooLarge: 'That file is too large to import.',
  unknownField: 'Lockset does not accept this field.',
  importFileUnreadable: 'The file could not be read.',
  importNotUtf8: 'Save the spreadsheet as UTF-8 CSV and try again.',
  importBadHeader: 'The first row must be the Lockset column headings.',
  importTooManyRows: 'Import at most 2,000 rows at a time.',
  importBadFilename: 'Give the file a name of 1 to 120 characters.',
  takesForce: (offset: OfficeOffset, date: OfficeDate): string =>
    `Takes force 00:00 ${offset}, ${formatOfficeDate(date)}`,
  inForceFrom: (offset: OfficeOffset, date: OfficeDate): string =>
    `In force from 00:00 ${offset}, ${formatOfficeDate(date)}`,
  draftStub: (minLength: number, offset: OfficeOffset, date: OfficeDate): string =>
    `Draft, waiting for the managing partner's signature: at least ${minLength} characters from 00:00 ${offset}, ${formatOfficeDate(date)}`,
  movedRun: (from: string): string => `Moved from ${from}: the clocks skip that hour.`,
} as const;
