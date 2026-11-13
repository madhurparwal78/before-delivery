import { roundHalfUp } from '../shared/engine.js';

export function two(value: number | null): string {
  return value === null ? '-' : roundHalfUp(value).toFixed(2);
}

export function percent(value: number | null): string {
  return value === null ? '-' : `${two(value)}%`;
}

export function whole(value: number): string {
  return String(roundHalfUp(value, 0));
}

export const COPY = {
  headline: 'TYPE IT. PROVE IT.',
  subhead: 'Timed tests whose every keystroke is replayed before it counts.',
  wordmark: 'STRIKEPROOF',
  footer: 'Strikeproof is made by Holloway Carriage Co.',
  focusButton: 'Click or press any key to focus',
  capsLock: 'Caps Lock is on',
  heldSeal: 'Held: replay in progress',
  counted: 'Counted',
  personalBest: 'New personal best',
  guestSeal: 'Not filed: sign in to keep your runs.',
  unverifiedSeal: 'Not filed: verify your email to keep your runs.',
  customLimit: 'Custom text can have at most 2000 characters and 400 words.',
  noErrors: 'No errors.',
  ticketFailed: 'Could not start a test. Check your connection and try again.',
  emptyHistory: 'Nothing filed yet. Your first counted run will be filed here.',
  noSuchRun: 'No such run.',
  emptyBoard: 'No counted runs on this board yet.',
  checkEmail: 'Check your email',
  mailDown: 'Email is unavailable. Your verification email will be sent when it recovers.',
  emailTaken: 'An account with that email already exists.',
  badName: 'Display name must be 1 to 24 characters.',
  badEmail: 'Enter a valid email address.',
  shortPassword: 'Password must be at least 10 characters.',
  verified: 'Email verified',
  verifiedLine: 'Your runs will now be filed.',
  linkExpired: 'Link expired',
  linkExpiredLine: 'This link has expired or was already used.',
  wrongSignIn: 'Email or password is incorrect.',
  resetRequested: 'If that email has an account, a reset link is on its way.',
  passwordChanged: 'Password changed',
  passwordChangedLine: 'Sign in with your new password.',
  raceSignedOut: 'Sign in to race.',
  unknownRoom: 'No room with that code.',
  fullRoom: 'This room is full.',
  startedRace: 'This race has already started.',
  raceFinishedHeading: 'Race finished',
  raceFinishedAnnouncement: 'Race finished.',
  pageNotFound: 'Page not found',
  serverError: 'Something went wrong. Try again.',
} as const;

export const NOT_COUNTED_REASONS: Record<string, string> = {
  wrong_text: 'the text does not match this test.',
  impossible_interval: 'keystrokes arrived faster than a person can type.',
  duration_mismatch: 'the test length does not match its mode.',
  replay_mismatch: 'the replay does not match the submitted result.',
  ticket_expired: 'this test expired before it was submitted.',
  invalid_log: 'the keystroke log is malformed.',
  log_too_long: 'the keystroke log is too long.',
  ticket_not_found: 'this test was not issued to you.',
};

export function notCountedSeal(code: string): string {
  return `Not counted: ${NOT_COUNTED_REASONS[code] ?? code}`;
}

export function resultLine(
  speed: number,
  accuracy: number,
  raw: number,
  consistency: number,
): string {
  return `Speed ${two(speed)}, accuracy ${two(accuracy)}%, raw ${two(raw)}, consistency ${two(consistency)}%.`;
}

export function signedUpLine(email: string): string {
  return `We sent a verification link to ${email}.`;
}

export function tooManyAttempts(seconds: number): string {
  return `Too many attempts. Try again in ${seconds} seconds.`;
}

export function boardChangeLine(name: string, rank: number, speed: number): string {
  return `${name} is now #${rank} with ${two(speed)} wpm.`;
}

export function customCount(characters: number, words: number): string {
  return `${characters} of 2000 characters, ${words} of 400 words`;
}

export function proofStub(proofKey: string): string {
  return `Proof ${proofKey.slice(0, 16)}`;
}

export function settingsApplied(label: string): string {
  return `${label} applied.`;
}

export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const last = value % 10;
  if (last === 1) return `${value}st`;
  if (last === 2) return `${value}nd`;
  if (last === 3) return `${value}rd`;
  return `${value}th`;
}

export function racerJoined(name: string): string {
  return `${name} joined.`;
}

export function racerLeft(name: string): string {
  return `${name} left.`;
}

export function newHost(name: string): string {
  return `${name} is now the host.`;
}

export function racerFinished(name: string, place: number, speed: number): string {
  return `${name} finished ${ordinal(place)} with ${two(speed)} wpm.`;
}

export function rejoinedRace(code: string): string {
  return `Rejoined race ${code}.`;
}

export function replayValueText(second: number, speed: number): string {
  return `${second} seconds, speed ${two(speed)}`;
}

export function utcDate(iso: string): string {
  return iso.slice(0, 10);
}

export function utcMinute(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function utcStamp(iso: string): string {
  return `${utcMinute(iso)} UTC`;
}
