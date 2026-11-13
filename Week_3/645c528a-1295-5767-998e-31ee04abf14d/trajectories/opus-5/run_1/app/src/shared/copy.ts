import { POCKET_LABELS, type FoulKind, type Pocket, type ResultCase } from './types.js';

/** Every number of 1,000 or more shown on screen uses thousands commas. */
export function num(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const whole = Math.trunc(abs);
  return sign + whole.toLocaleString('en-US');
}

export function oneDecimal(value: number): string {
  return value.toFixed(1);
}

export const FOUL_COPY: Record<FoulKind, string> = {
  scratch: 'Foul: cue ball scratched.',
  'wrong-first': 'Foul: first contact was not your group.',
  'no-contact': 'Foul: cue ball hit nothing.',
  'no-cushion': 'Foul: no ball reached a cushion after contact.',
  'off-table': 'Foul: ball left the table.',
  clock: 'Foul: shot clock expired.',
};

export const WRONG_FIRST_NINE = 'Foul: first contact was not the lowest ball.';
export const ILLEGAL_BREAK = 'Illegal break: opponent gets ball in hand behind the head string.';
export const EIGHT_ON_BREAK = '8 on the break: re-spotted, shooter continues.';
export const LEGAL_NOTHING = 'Legal shot: nothing potted.';
export const CALL_A_POCKET = 'Call a pocket before you shoot.';

export function groupClaimLine(name: string, group: 'solids' | 'stripes'): string {
  return group === 'solids' ? `${name} takes solids.` : `${name} takes stripes.`;
}

export function potLine(ball: number, pocket: Pocket): string {
  return `Ball ${ball} potted in ${POCKET_LABELS[pocket]}.`;
}

export function ballInHandLine(name: string): string {
  return `${name} has ball in hand.`;
}

export const PRACTICE_THINKING = (opponent: string): string => `${opponent} is thinking`;
export const PRACTICE_TURN_DONE = (opponent: string): string => `${opponent} finished its turn`;
export const NO_POWER_CANCEL = 'No power. Shot cancelled.';
export const HOLD_CANCEL = 'Shot cancelled.';

export const RESULT_LINES: Record<
  Exclude<ResultCase, 'void'>,
  { winner: (name: string) => string; loser: (name: string) => string }
> = {
  called: {
    winner: () => 'You won: 8 in the called pocket.',
    loser: (name) => `You lost: ${name} potted the 8 in the called pocket.`,
  },
  early: {
    winner: (name) => `You won: ${name} potted the 8 early.`,
    loser: () => 'You lost: 8 potted before your group was cleared.',
  },
  uncalled: {
    winner: (name) => `You won: ${name} potted the 8 in an uncalled pocket.`,
    loser: () => 'You lost: 8 potted in an uncalled pocket.',
  },
  'scratch-on-8': {
    winner: (name) => `You won: ${name} scratched on the 8.`,
    loser: () => 'You lost: scratched on the 8.',
  },
  'foul-on-8': {
    winner: (name) => `You won: ${name} fouled on the 8.`,
    loser: () => 'You lost: foul on the 8.',
  },
  forfeit: {
    winner: (name) => `You won: ${name} forfeited.`,
    loser: () => 'You lost: forfeited after 3 timed-out turns.',
  },
  nine: {
    winner: () => 'You won: 9 potted legally.',
    loser: (name) => `You lost: ${name} potted the 9.`,
  },
};

export const VOID_LINE = 'Match voided: both entries returned.';
export const GAME_OVER = 'Game over';

export function coinChangeWon(pot: number): string {
  return `Pot won: ${num(pot)} Coins`;
}
export function coinChangeLost(entry: number): string {
  return `Entry lost: ${num(entry)} Coins`;
}
export function coinChangeReturned(entry: number): string {
  return `Entry returned: ${num(entry)} Coins`;
}
export const COIN_CHANGE_NONE = 'No Coins at stake';
export function xpGained(xp: number): string {
  return `+${num(xp)} XP`;
}
export function levelUpLine(level: number): string {
  return `Level ${num(level)} reached: +5 Cash`;
}
export const REMATCH_UNFUNDED = 'Not enough Coins for a rematch.';
export function rematchWaiting(name: string): string {
  return `Waiting for ${name}.`;
}

export const AUTH_COPY = {
  underAge: 'Headstring is for players 13 and over.',
  minorNote: 'Age under 18: tables are open, Cash packs are not.',
  pending: 'Creating your account',
  email: 'Enter a valid email address.',
  password: 'Use at least 8 characters.',
  displayName: 'Use 2 to 20 characters.',
  birthYear: 'Enter a four-digit year.',
  emailTaken: 'That email already has an account.',
  badSignIn: 'Email or password is wrong.',
  rateLimit: 'Too many tries. Wait a minute and try again.',
};

export const HOME_COPY = {
  firstMatch: 'First match',
  dailyClaimed: 'Daily reward claimed.',
  dailyAlready: 'Daily reward already claimed today.',
  refillAdded: 'Refill added.',
  refillUsedUp: 'No Refills left today. Back after midnight UTC.',
  refillNotNeeded: 'Refill is for balances under 100 Coins.',
  offline: 'Offline',
  storeDown: 'Could not reach the table',
  stale: 'Stale',
  mailDelayed: 'Verification mail is delayed. Play on; we will retry.',
};

export const PLAY_COPY = {
  lockedTier: (minLevel: number) => `Reach level ${num(minLevel)}`,
  unaffordable: (shortfall: number) => `Short by ${num(shortfall)} Coins`,
  searching: (band: number) => `Searching within ${num(band)} levels`,
  leftQueue: 'Left the queue. No Coins moved.',
  insufficientCoins: 'Not enough Coins for this table.',
  modeLocked: 'Unlocks at level 5',
  secondDevice: "You're in a match on another device",
  lateShot: 'Too late. The shot clock ran out.',
  dropped: (name: string, seconds: number) => `${name} dropped: ${num(seconds)}s to reconnect`,
  notYours: 'This table is private to its players.',
  unknownTable: 'Table not found',
  notFound: 'Nothing on this table',
  practiceResume: 'Resume your unfinished rack?',
};

export const SHOP_COPY = {
  bought: (name: string) => `Bought ${name}.`,
  equipped: (name: string) => `Equipped ${name}.`,
  owned: 'Owned',
  equippedMark: 'Equipped',
  shortFunds: (shortfall: number, currency: 'Coins' | 'Cash') =>
    `You need ${num(shortfall)} more ${currency}.`,
  levelLocked: (minLevel: number) => `Reach level ${num(minLevel)} to buy this.`,
  confirming: 'Confirming',
  cashAdded: (cash: number, email: string) => `Cash added: ${num(cash)} Cash. Receipt sent to ${email}.`,
  cashAddedDelayed: (cash: number) => `Cash added: ${num(cash)} Cash. Receipt delayed. Your Cash is safe.`,
  paymentsDown: 'Payments are down. You have not been charged.',
  underEighteen: 'Players under 18 cannot buy Cash.',
  unverified: 'Verify your email to buy Cash.',
  resent: (email: string) => `Verification email sent to ${email}.`,
  mailDown: 'Could not send mail. Try again soon.',
};

export const FRIENDS_COPY = {
  requestSent: (name: string) => `Request sent to ${name}.`,
  accepted: (name: string) => `${name} is now your friend.`,
  unknownCode: 'No player has that code.',
  blocked: "You can't add this player.",
  presence: { online: 'Online', in_match: 'In a match', offline: 'Offline' },
  expired: 'Expired',
  hostWaiting: 'Waiting for your friend',
  loggedOutNote: 'Sign up to join the table',
};

export const CLUB_COPY = {
  joined: (name: string) => `Joined ${name}.`,
  requested: (name: string) => `Request sent to ${name}.`,
  left: (name: string) => `Left ${name}.`,
  full: 'Club is full',
  ownerLeaving: 'Owners must hand over the club before leaving.',
  roleChanged: (name: string, role: string) => `${name} is now ${role}.`,
  createLevel: 'Reach level 5 to create a club.',
  createCoins: 'You need 5,000 Coins to create a club.',
  ownRank: (rank: number, name: string, wins: number) => `#${num(rank)} ${name} ${num(wins)} wins`,
  unranked: 'Unranked',
  friendsEmpty: 'No friends on the board yet.',
  clubEmpty: 'Join a club to see this board.',
  presets: ['Good luck', 'Nice shot', 'Well played', 'Back soon', 'Ready to play?'],
};

export const TOURNAMENT_COPY = {
  entrants: (n: number) => `${num(n)} of 8 entered`,
  registered: (entry: number) => `Registered. ${num(entry)} Coins moved to the bracket.`,
  bracketDrawn: 'Bracket drawn. Ready check started.',
  readyCheck: (seconds: number) => `Ready check: ${num(seconds)}s left`,
  readyPressed: 'You are ready.',
  allReady: 'All players ready.',
  windowShort: (entry: number) => `Not enough players. Your ${num(entry)} Coins are back.`,
  readyMissed: (entry: number) => `Ready check missed. Your ${num(entry)} Coins are back.`,
  bracketFull: 'Bracket is full',
};

export const VERIFY_COPY = {
  heading: 'Email verified',
  invalid: 'This link is no longer valid.',
};

export function shotReceipt(firstBall: number | null, cutAngle: number | null): string {
  if (firstBall === null || cutAngle === null) return 'No first ball.';
  return `First ball ${firstBall}. Cut ${oneDecimal(cutAngle)}°.`;
}

export const LOUPE_LABELS = { legal: 'Legal', wrong: 'Wrong group', blocked: 'Blocked' };

export function loupeNumeral(cutAngle: number | null): string {
  return cutAngle === null ? 'Cut --' : `Cut ${oneDecimal(cutAngle)}°`;
}

export const SPIN_TEXT = {
  none: 'Spin: none',
  top: 'Spin: top',
  back: 'Spin: back',
  left: 'Spin: left',
  right: 'Spin: right',
};

export function ledgerKindLabel(kind: string): string {
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
