import type { RestRule } from './api.js';
import { oneDecimal } from './dom.js';

export const COPY = {
  connection: (queued: number): string =>
    `Logging on board. Entries will sync when the ship reconnects. ${queued} queued`,
  archiveUnreachable: 'Archive unreachable. Hours are still being logged; sealing resumes on its own.',
  breach: 'Breach',
  windowVerdictPass: (start: string, end: string, rest: number): string =>
    `${start} to ${end}: ${oneDecimal(rest)} hours of rest. This window passes the rules.`,
  windowVerdictBreach: (start: string, end: string, rest: number): string =>
    `${start} to ${end}: ${oneDecimal(rest)} hours of rest. Breach recorded. It stays on this record.`,
  windowVerdictIncomplete: (start: string, end: string, rest: number): string =>
    `${start} to ${end}: ${oneDecimal(rest)} hours of rest. This window is not fully logged yet.`,
  ruleSetStandard: 'Judged under the standard rules.',
  ruleSetFlagException: 'Judged under the flag exception rules.',
  restOfWindow: (rest: number): string => `${oneDecimal(rest)} hours of rest`,
  restIn24: (rest: number): string => `${oneDecimal(rest)} hours in the last 24 hours`,
  restIn168: (rest: number): string => `${oneDecimal(rest)} hours in the last 7 days`,
  recordedBreachChanged: 'Recorded breach. The hours were later changed.',
  noBreaches: 'No breaches recorded.',
  recordMismatch:
    'Record mismatch: a drill or call-out overlaps hours logged as rest. Add a note to explain it.',
  lateEntry: 'Late entry',
  shortBreakHint: 'Breaks under one hour do not count as rest.',
  recordPaneLine: (shipDate: string, month: string): string =>
    `Ship's day ${shipDate}, in month ${month}.`,
  openDayLine: (closesAt: string): string => `You can edit this ship's day until ${closesAt}.`,
  closedDayLine: "This ship's day has closed.",
  zoneWarning:
    'The new offset is more than 1 hour from the nautical zone for this longitude. Ships may keep port time, so the change is saved.',
  planPass: 'This plan passes the rules.',
  planBreach: (windows: number): string => `This plan breaches the rules in ${windows} windows.`,
  signDialogText: (shipDate: string): string =>
    `By signing you confirm these are your hours for ${shipDate}.`,
  globeNoFix: 'No position logged yet.',
  inspectorNothingSealed: 'Nothing is sealed in this date range.',
  linkExpired: 'This inspection link has expired.',
  linkRevoked: 'This inspection link has been revoked.',
  linkUnknown: "We couldn't find that inspection link.",
  pageUnknown: "We couldn't find that page.",

  signingIn: 'Signing in.',
  badCredentials: 'That email and passcode do not match.',
  emailTaken: 'That email already has an account.',
  somethingWrong: 'Something went wrong. Try again.',

  saving: 'Saving.',
  saved: 'Saved.',
  queued: 'Queued.',
  dayClosedSave: "This ship's day has closed, so the server did not save that entry.",
  syncing: 'Syncing.',
  synced: (entries: number): string => `Synced ${entries} entries.`,
  syncedLate: (late: number): string => ` ${late} marked Late entry.`,

  signing: 'Signing.',
  signed: 'Signed.',
  dayStillOpen: "This ship's day is still open, so it cannot be signed yet.",
  signingOffline: 'Signing needs a connection.',
  countersigning: 'Countersigning.',
  countersigned: 'Countersigned.',
  notSignedYet: 'The crew member has not signed this day yet.',
  countersigningOffline: 'Countersigning needs a connection.',

  savingNote: 'Saving note.',
  noteSaved: 'Note saved.',
  writeNoteFirst: 'Write a note first.',
  notesOffline: 'Notes need a connection.',

  awaitingArchive: 'Awaiting archive',
  sealedLabel: 'Sealed',
  monthNotReady: 'Every logged day must be signed and countersigned first.',

  savingVessel: 'Saving vessel.',
  vesselSaved: 'Vessel saved.',
  vesselLimit: 'You already run four vessels.',
  savingCrew: 'Saving crew member.',
  crewSaved: 'Crew member saved.',
  savingClockChange: 'Saving clock change.',
  clockChangeSaved: 'Clock change saved.',
  checkingPlan: 'Checking plan.',
  schedulingRuleSet: 'Scheduling rule set.',
  ruleSetScheduled: 'Rule set scheduled.',
  creatingLink: 'Creating link.',
  linkCreated: 'Link created.',
  revokingLink: 'Revoking link.',
  linkRevokedFeedback: 'Link revoked.',
  replacingLink: 'Replacing link.',
  linkReplaced: 'Link replaced. The old link no longer opens.',
  linkEnded: 'This link no longer opens.',
  documentArchiveDown: 'The archive is unreachable, so this document cannot be fetched right now.',
  downloadOffline: 'Downloading needs a connection.',
};

export const DAY_STATE_LABELS: Record<string, string> = {
  open: 'Open',
  closed: 'Closed',
  signed: 'Signed',
  countersigned: 'Countersigned',
};

export const MONTH_STATE_LABELS: Record<string, string> = {
  open: 'Open',
  awaiting_archive: 'Awaiting archive',
  sealed: 'Sealed',
};

export const CELL_STATE_NAMES: Record<string, string> = {
  not_logged: 'Not logged',
  rest: 'Rest',
  work: 'Work',
  short_break: 'Rest under one hour',
};

/** One sentence per failed rule, with the limit of the rule set that judged the window. */
export function ruleSentence(rule: RestRule, ruleSet: 'standard' | 'flag_exception'): string {
  switch (rule) {
    case 'rest_24h':
      return 'Less than 10 hours of rest in this 24-hour window.';
    case 'rest_periods':
      return `Rest was split into more than ${
        ruleSet === 'flag_exception' ? 3 : 2
      } periods in this 24-hour window.`;
    case 'six_hour_block':
      return 'No rest period of at least 6 hours touches this 24-hour window.';
    case 'fourteen_hour_gap':
      return 'More than 14 hours passed between rest periods in this 24-hour window.';
    case 'rest_168h':
      return `Less than ${ruleSet === 'flag_exception' ? 70 : 77} hours of rest in this 168-hour window.`;
    case 'three_period_days':
      return 'Three rest periods were used on more than two 24-hour periods in these 7 days.';
  }
}
