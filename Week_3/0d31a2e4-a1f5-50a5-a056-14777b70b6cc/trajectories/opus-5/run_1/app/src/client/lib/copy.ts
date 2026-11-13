import { ApiError } from './api.js';

const MAIL_DOWN = 'Mail is down right now. Try again in a minute.';
const LINK_EXPIRED = 'This link has expired. Request a new one.';
const LINK_INVALID = 'This link has already been used or replaced by a newer one.';
const PASSWORD_FIELD = 'Use 10 to 128 characters.';

export const copy = {
  creatingAccount: 'Creating account…',
  accountCreatedMailSent: (email: string): string =>
    `Account created. Check ${email} for your verification link.`,
  accountCreatedMailFailed:
    "Account created, but we couldn't send your verification email. Resend it once mail is back.",
  emailTaken: 'That email already has an account.',
  handleTaken: 'That handle is taken.',
  sending: 'Sending…',
  verificationSent: (email: string): string => `Verification email sent to ${email}.`,
  alreadyVerified: 'Your email is already verified.',
  mailDown: MAIL_DOWN,
  checkingLink: 'Checking your link…',
  emailVerified: 'Email verified. You can add friends and play.',
  linkExpired: LINK_EXPIRED,
  linkInvalid: LINK_INVALID,
  verifyBanner: 'Verify your email to add friends and find matches.',
  verifyFirst: 'Verify your email first.',
  signingIn: 'Signing in…',
  signInFailed: 'Email or password is wrong.',
  resetLinkSent: 'If that email has an account, a reset link is on its way.',
  saving: 'Saving…',
  passwordChanged: 'Password changed. Sign in with your new password.',
  passwordField: PASSWORD_FIELD,
  requestSent: (handle: string): string => `Friend request sent to ${handle}.`,
  nowFriends: (handle: string): string => `You and ${handle} are now friends.`,
  noPlayer: (handle: string): string => `No player called ${handle}.`,
  cantAddYourself: "You can't add yourself.",
  alreadyFriends: (handle: string): string => `You're already friends with ${handle}.`,
  cantAddPlayer: "You can't add this player.",
  requestClosed: 'That request is no longer open.',
  requestDeclined: 'Request declined.',
  requestWithdrawn: 'Request withdrawn.',
  friendRemoved: (handle: string): string => `${handle} removed from friends.`,
  blocked: (handle: string): string => `${handle} is blocked.`,
  unblocked: (handle: string): string => `${handle} is unblocked.`,
  inviteSent: (handle: string): string => `Invite sent to ${handle}.`,
  joinedParty: (handle: string): string => `You joined ${handle}'s party.`,
  partyFull: 'That party is full.',
  partyBusy: 'That party is busy right now. Try again after its search or match.',
  notLeader: 'Only the party leader can do that.',
  friendsOnly: 'You can only invite friends.',
  inviteClosed: 'That invite is no longer open.',
  inviteDeclined: 'Invite declined.',
  leftParty: 'You left the party.',
  newLeader: (handle: string): string => `${handle} is now party leader.`,
  findingMatch: 'Finding a match…',
  seated: 'Seated in a lobby.',
  alreadySearching: 'Your party is already searching or playing.',
  searchCancelled: 'Search cancelled.',
  notSearching: "Your party isn't searching any more.",
  leftLobby: 'You left the lobby.',
  countdownCancelled: 'A player left. Countdown cancelled — waiting for players.',
  matchOver: (id: number): string => `Cup #${id} is over. You're back with your party.`,
  forfeited: 'You forfeited this round.',
  messageField: 'Messages are 1 to 500 characters.',
  slowDown: 'Slow down — you can send again in a few seconds.',
  cantMessage: "You can't message this player.",
  connectingVoice: 'Connecting…',
  joinedVoice: 'You joined voice.',
  microphoneBlocked: 'Microphone blocked. Allow microphone access to talk.',
  reconnecting: 'Reconnecting…',
  backOnline: 'Back online.',
  unexpected: 'Something went wrong. Try again.',
  cantDoThat: "That can't be done right now.",
  checkFields: 'Check the highlighted fields.',
  qualified: 'Qualified!',
  eliminated: 'Eliminated',
  wonCup: 'You won Pratfall Cup!',
  waitingForLeader: (handle: string): string => `Waiting for ${handle} to start a match`,
  searchingNotice: 'Searching for a lobby…',
};

/** Turns a rejection into the one line this product shows for it. */
export function errorCopy(error: unknown, map: Record<string, string> = {}): string {
  if (!(error instanceof ApiError)) return copy.unexpected;
  const mapped = map[error.code];
  if (mapped !== undefined) return mapped;
  if (error.code === 'email_unverified') return copy.verifyFirst;
  if (error.code === 'mail_unavailable') return copy.mailDown;
  if (error.status >= 500) return copy.unexpected;
  return copy.cantDoThat;
}

export const FIELD_ERROR_CODES = new Set(['validation_failed']);
