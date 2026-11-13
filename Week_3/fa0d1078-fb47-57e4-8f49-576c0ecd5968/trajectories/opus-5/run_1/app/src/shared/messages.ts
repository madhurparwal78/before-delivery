import type { Cell, Digit } from './board';
import { cellColumn, cellRow } from './board';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export const M = {
  /** M01 */
  givenLocked: "Given cells can't be changed.",
  /** M02 */
  hintedLocked: "Hinted cells can't be changed.",
  /** M03 */
  correctLocked: "Correct entries can't be changed.",
  /** M04 */
  nothingToUndo: 'Nothing to undo.',
  /** M05 */
  nothingToRedo: 'Nothing to redo.',
  /** M06 */
  correctEntry: (cell: Cell, digit: Digit): string =>
    `Row ${cellRow(cell)}, column ${cellColumn(cell)}, ${digit}.`,
  /** M07 */
  mistakeEntry: (cell: Cell, digit: Digit, mistakes: number, limit: number): string =>
    `Row ${cellRow(cell)}, column ${cellColumn(cell)}, ${digit}, wrong. Mistakes ${mistakes} of ${limit}.`,
  /** M08 */
  noteAdded: (cell: Cell, digit: Digit): string =>
    `Note ${digit} added to row ${cellRow(cell)}, column ${cellColumn(cell)}.`,
  /** M08 */
  noteRemoved: (cell: Cell, digit: Digit): string =>
    `Note ${digit} removed from row ${cellRow(cell)}, column ${cellColumn(cell)}.`,
  /** M09 */
  erased: (cell: Cell): string => `Row ${cellRow(cell)}, column ${cellColumn(cell)} erased.`,
  /** M10 */
  undone: 'Undone.',
  /** M10 */
  redone: 'Redone.',
  /** M11 */
  gameOverBody: (limit: number): string => `You made ${limit} mistakes.`,
  /** M12 */
  gameOverBodyUsed: (limit: number): string =>
    `You made ${limit} mistakes. Your second chance is used.`,
  /** M13 */
  gameOverAnnounce: (limit: number): string => `Game over. ${limit} mistakes.`,
  /** M14 */
  pausedBody: 'Your game is paused.',
  /** M15 */
  paused: 'Paused.',
  /** M15 */
  resumed: 'Resumed.',
  /** M16 */
  hint: (cell: Cell, digit: Digit, hintsLeft: number): string =>
    `Hint: row ${cellRow(cell)}, column ${cellColumn(cell)} is ${digit}. Hints left ${hintsLeft}.`,
  /** M17 */
  noHintsLeft: 'No hints left.',
  /** M18 */
  solvedBody: (time: string, mistakes: number, hints: number, score: number): string =>
    `Solved in ${time} with ${plural(mistakes, 'mistake', 'mistakes')} and ${plural(hints, 'hint', 'hints')}. Score ${score}.`,
  /** M19 */
  solvedAnnounce: (time: string, score: number): string => `Solved in ${time}. Score ${score}.`,
  /** M20 */
  notCounted: (code: string): string =>
    `This game could not be verified (${code}). It was not counted.`,
  /** M21 */
  notSaved: "Your game wasn't saved. It will be saved with your next move.",
  /** M22 */
  checking: 'Checking your game.',
  /** M23 */
  notesOn: 'Notes on.',
  /** M23 */
  notesOff: 'Notes off.',
  /** M24 */
  secondChance: (mistakes: number, limit: number): string =>
    `Second chance. Mistakes ${mistakes} of ${limit}.`,
  /** M25 */
  gameNotFound: "This game isn't in the collection.",
  /** M26 */
  pageNotFound: "This page isn't in the collection.",
  /** M27 */
  notVerifiedDuel: 'Confirm your email to join duels.',
  /** M28 */
  rateLimited: 'Too many tries. Wait a minute and try again.',
  /** M29 */
  roomNotFound: 'No room has that code.',
  /** M30 */
  hintsOffInDuels: 'Hints are off in duels.',
  /** M31 */
  noPauseInDuels: "Duels can't be paused.",
  /** M32 */
  waitingForSecondPlayer: 'Waiting for a second player.',
  /** M33 */
  startingIn: (seconds: number): string => `Starting in ${seconds}`,
  /** M34 */
  duelWin: (time: string): string => `You win! You finished first in ${time}.`,
  /** M35 */
  duelLoss: (name: string, time: string): string =>
    `${name} wins. They finished first in ${time}.`,
  /** M36 */
  duelTie: "It's a tie.",
  /** M37 */
  duelOut: (limit: number, name: string): string =>
    `You're out: ${limit} mistakes. ${name} wins.`,
  /** M37 */
  duelOpponentOut: (name: string): string => `${name} is out. You win.`,
  /** M38 */
  duelForfeitWin: (name: string): string => `${name} left the duel. You win.`,
  /** M39 */
  opponentReconnecting: (name: string): string => `${name} is reconnecting.`,
  /** M39 */
  opponentBack: (name: string): string => `${name} is back.`,
  /** M40 */
  liveUnavailable:
    'Live duels are unavailable right now. Solo games and the daily challenge still work.',
  /** M41 */
  roomFull: 'This room already has two players.',
  /** M42 */
  duelStarted: 'The duel has started.',
  /** M43 */
  leaderboardUpdate: (name: string, rank: number): string =>
    `${name} finished at rank ${rank}.`,
  /** M44 */
  confirmEmailBanner: 'Confirm your email to join duels and the leaderboard.',
  /** M45 */
  confirmEmailLeaderboard: 'Confirm your email to appear on the leaderboard.',
  /** M46 */
  confirmationResent: 'A new confirmation email is on its way.',
  /** M47 */
  liveUpdatesPaused: 'Live updates are paused. Reload to see new results.',
  /** M48 */
  leaderboardEmpty: 'No one has finished this daily yet.',
  /** M49 */
  signupMailDown:
    "Your account is ready, but we couldn't send the confirmation email. Use Send again in a minute.",
  /** M50 */
  mailUnavailable: "We couldn't send email right now. Try again in a minute.",
  /** M51 */
  resetSent: 'If that email has an account, a reset link is on its way.',
  /** M52 */
  badCredentials: 'Email or password is incorrect.',
  /** M53 */
  emailConfirmed: 'Your email is confirmed.',
  /** M53 */
  passwordSaved: 'Your password is saved.',
  /** M54 */
  verifyUsed: 'This confirmation link was already used.',
  /** M54 */
  verifyExpired: 'This confirmation link has expired.',
  /** M54 */
  verifyInvalid: "This confirmation link isn't valid.",
  /** M55 */
  resetUsed: 'This reset link was already used.',
  /** M55 */
  resetExpired: 'This reset link has expired.',
  /** M55 */
  resetInvalid: "This reset link isn't valid.",
  /** M56 */
  unexpected: 'Something went wrong at the atelier. Try again.',
  /** M57 */
  preparing: 'The atelier is preparing your page.',
  /** M58 */
  noFinishedGames: 'No finished games yet. The first one is waiting.',
  /** M59 */
  pendingSignup: 'Creating your account.',
  /** M59 */
  pendingSignin: 'Signing you in.',
  /** M59 */
  pendingReset: 'Sending the reset link.',
  /** M59 */
  pendingRoom: 'Opening the room.',
  /** M60 */
  emailFormat: 'Enter a valid email address.',
  /** M60 */
  emailTaken: 'That email already has an account.',
  /** M60 */
  displayNameLength: 'Use 3 to 20 characters.',
  /** M60 */
  displayNameTaken: 'That display name is taken.',
  /** M60 */
  passwordLength: 'Use at least 10 characters.',
  /** M61 */
  storageUnavailable: "The atelier's records are out of reach. Try again in a minute.",
} as const;

export function stitchesLabel(prefix: string, stitches: number): string {
  return `${prefix}: ${plural(stitches, 'stitch', 'stitches')}`;
}

export function streakLine(label: string, days: number): string {
  return `${label}: ${plural(days, 'day', 'days')}`;
}
