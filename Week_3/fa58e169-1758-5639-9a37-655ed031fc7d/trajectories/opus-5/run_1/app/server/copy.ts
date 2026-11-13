import { limits } from './config';

export const copy = {
  patternName: 'Give the pattern a name.',
  patternNameLong: 'A pattern name can be 120 characters at most.',
  patternRows: `Rows must be from 1 to ${limits.maxChartRows}.`,
  patternColumns: `Columns must be from 1 to ${limits.maxChartCols}.`,
  patternCastOn: 'Cast on must be at least 1.',
  patternKind: 'Choose a chart kind.',
  colourName: 'Enter a colour name.',
  colourHex: 'Enter a colour as # and six hex digits.',
  colourLimit: `A pattern can have ${limits.maxColours} colours.`,
  coDesignerUnknown: 'No Twinrow account has that email.',
  testerEmail: 'Enter a valid email address.',
  testerAlready: 'That person is already testing this pattern.',
  testerNoVersion: 'Save a version before inviting testers.',
  versionNoteLong: 'A version note can be 200 characters at most.',
  noteEmpty: 'Write a note first.',
  noteLong: `A note can be ${limits.noteMaxChars} characters at most.`,
  signUpName: 'Enter your name.',
  signUpEmail: 'Enter a valid email address.',
  signUpPassword: 'A password needs at least 10 characters.',
  signUpTaken: 'That email already has an account.',
  signInWrong: 'Email or password is incorrect.',
  signInUnverified: 'Verify your email first.',
  settingsPassword: 'That password is not right.',
  verifyExpired: 'This link has expired. Sign up again to get a new one.',
  inviteExpired: 'This invitation has expired. Ask the designer for a new one.',
  inviteUsed: 'This invitation has already been used.',
  rateLimited: 'Too many edits. Wait a moment.',
  publishNoVersion: 'Save a version before publishing.',
  mirrorCrossesRepeat: 'Mirror cannot cross a repeat box.',
  repeatOverlap: 'Repeat boxes cannot overlap.',
  repeatTooWide: `That is wider than the ${limits.maxChartCols} column limit.`,
  repeatTimes: 'Times must be from 2 to 20.',
  followLatest: 'Only the latest version can be followed.',
  invalidJson: 'The request body is not valid JSON.',
};

export function publishRowErrors(count: number): string {
  return `Fix ${count} row ${count === 1 ? 'error' : 'errors'} before publishing.`;
}
