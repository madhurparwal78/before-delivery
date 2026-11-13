// Long Rail Headstring frontend. Plain ES modules, no framework, served by the app itself.

export const fmt = (n) => Number(n).toLocaleString('en-US');

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export async function api(path, options = {}) {
  const init = { headers: {}, credentials: 'same-origin', ...options };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!res.ok) {
    const err = new Error(body?.message ?? 'Request failed');
    err.status = res.status;
    err.code = body?.error ?? 'unknown';
    err.fields = body?.errors ?? null;
    throw err;
  }
  return body;
}

export function navigate(path) {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function toast(message) {
  const region = document.getElementById('toasts');
  if (!region) return;
  const item = el('div', { class: 'toast', text: message });
  region.append(item);
  setTimeout(() => item.remove(), 4200);
}

export const copy = {
  underAge: 'Headstring is for players 13 and over.',
  ageNote: 'Age under 18: tables are open, Cash packs are not.',
  pending: 'Creating your account',
  emailInvalid: 'Enter a valid email address.',
  passwordInvalid: 'Use at least 8 characters.',
  displayNameInvalid: 'Use 2 to 20 characters.',
  yearInvalid: 'Enter a four-digit year.',
  emailTaken: 'That email already has an account.',
  badSignIn: 'Email or password is wrong.',
  rateLimited: 'Too many tries. Wait a minute and try again.',
  dailyClaimed: 'Daily reward claimed.',
  dailyAlready: 'Daily reward already claimed today.',
  refillAdded: 'Refill added.',
  refillNone: 'No Refills left today. Back after midnight UTC.',
  refillNotNeeded: 'Refill is for balances under 100 Coins.',
  offline: 'Offline',
  storeDown: 'Could not reach the table',
  stale: 'Stale',
  mailDelayed: 'Verification mail is delayed. Play on; we will retry.',
  firstMatch: 'First match',
  lockedTier: (level) => `Reach level ${level}`,
  shortBy: (n) => `Short by ${fmt(n)} Coins`,
  queueSearching: (band) => `Searching within ${band} levels`,
  leftQueue: 'Left the queue. No Coins moved.',
  refusedCoins: 'Not enough Coins for this table.',
  modeLocked: (level) => `Unlocks at level ${level}`,
  secondDevice: `You're in a match on another device`,
  lateShot: 'Too late. The shot clock ran out.',
  dropped: (name, seconds) => `${name} dropped: ${seconds}s to reconnect`,
  tableNotYours: 'This table is private to its players.',
  tableUnknown: 'Table not found',
  notFoundHeading: 'Nothing on this table',
  practiceResume: 'Resume your unfinished rack?',
  bought: (name) => `Bought ${name}.`,
  equipped: (name) => `Equipped ${name}.`,
  owned: 'Owned',
  equippedWord: 'Equipped',
  shortFunds: (n, currency) => `You need ${fmt(n)} more ${currency}.`,
  levelLockedItem: (level) => `Reach level ${level} to buy this.`,
  confirming: 'Confirming',
  packSent: (cash, email) => `Cash added: ${cash} Cash. Receipt sent to ${email}.`,
  packDelayed: (cash) => `Cash added: ${cash} Cash. Receipt delayed. Your Cash is safe.`,
  paymentsDown: 'Payments are down. You have not been charged.',
  under18: 'Players under 18 cannot buy Cash.',
  unverified: 'Verify your email to buy Cash.',
  resent: (email) => `Verification email sent to ${email}.`,
  mailDownResend: 'Could not send mail. Try again soon.',
  verifiedHeading: 'Email verified',
  linkInvalid: 'This link is no longer valid.',
  requestSent: (name) => `Request sent to ${name}.`,
  friendAccepted: (name) => `${name} is now your friend.`,
  unknownCode: 'No player has that code.',
  blockedFriend: `You can't add this player.`,
  inviteExpired: 'Expired',
  hostWaiting: 'Waiting for your friend',
  inviteNote: 'Sign up to join the table',
  joinedClub: (name) => `Joined ${name}.`,
  requestedClub: (name) => `Request sent to ${name}.`,
  leftClub: (name) => `Left ${name}.`,
  clubFull: 'Club is full',
  ownerLeaving: 'Owners must hand over the club before leaving.',
  roleChanged: (name, role) => `${name} is now ${role}.`,
  clubLevel: (level) => `Reach level ${level} to create a club.`,
  clubCoins: (n) => `You need ${fmt(n)} Coins to create a club.`,
  unranked: 'Unranked',
  friendsBoardEmpty: 'No friends on the board yet.',
  clubBoardEmpty: 'Join a club to see this board.',
  entrants: (n, total) => `${n} of ${total} entered`,
  registered: (entry) => `Registered. ${fmt(entry)} Coins moved to the bracket.`,
  bracketDrawn: 'Bracket drawn. Ready check started.',
  readyCheck: (seconds) => `Ready check: ${seconds}s left`,
  youAreReady: 'You are ready.',
  allReady: 'All players ready.',
  windowShort: (entry) => `Not enough players. Your ${fmt(entry)} Coins are back.`,
  readyMissed: (entry) => `Ready check missed. Your ${fmt(entry)} Coins are back.`,
  bracketFull: 'Bracket is full',
  foulScratch: 'Foul: cue ball scratched.',
  foulWrongGroup: 'Foul: first contact was not your group.',
  foulWrongNine: 'Foul: first contact was not the lowest ball.',
  foulNoContact: 'Foul: cue ball hit nothing.',
  foulNoCushion: 'Foul: no ball reached a cushion after contact.',
  foulOffTable: 'Foul: ball left the table.',
  foulClock: 'Foul: shot clock expired.',
  illegalBreak: 'Illegal break: opponent gets ball in hand behind the head string.',
  eightOnBreak: '8 on the break: re-spotted, shooter continues.',
  groupClaimed: (name, group) => `${name} takes ${group}.`,
  potted: (ball, pocket) => `Ball ${ball} potted in ${pocket}.`,
  legalNothing: 'Legal shot: nothing potted.',
  callPocket: 'Call a pocket before you shoot.',
  ballInHand: (name) => `${name} has ball in hand.`,
  aiThinking: (name) => `${name} is thinking`,
  aiTurnDone: (name) => `${name} finished its turn`,
  noPower: 'No power. Shot cancelled.',
  shotCancelled: 'Shot cancelled.',
  turnYours: 'Your turn',
  turnOther: (name) => `${name}'s turn`,
  turnBallInHand: 'Ball in hand',
  gameOver: 'Game over',
  noStake: 'No Coins at stake',
  xpGained: (xp) => `+${xp} XP`,
  levelReached: (level, cash) => `Level ${level} reached: +${cash} Cash`,
  rematchShort: 'Not enough Coins for a rematch.',
  waitingRematch: (name) => `Waiting for ${name}.`,
  storeUnavailable: 'Could not reach the table',
};

export const TIERS = [
  { id: 1, name: 'Corner Bar', minLevel: 1, entry: 100, pot: 180 },
  { id: 2, name: 'Back Room', minLevel: 3, entry: 500, pot: 900 },
  { id: 3, name: 'Downtown', minLevel: 7, entry: 2500, pot: 4500 },
  { id: 4, name: 'Velvet Room', minLevel: 12, entry: 10000, pot: 18000 },
  { id: 5, name: 'The Penthouse', minLevel: 20, entry: 50000, pot: 90000 },
];

export const POCKET_LABELS = [
  ['top-left', 'Top left'],
  ['top-right', 'Top right'],
  ['middle-left', 'Middle left'],
  ['middle-right', 'Middle right'],
  ['bottom-left', 'Bottom left'],
  ['bottom-right', 'Bottom right'],
];

export const PRESET_MESSAGES = ['Good luck', 'Nice shot', 'Well played', 'Back soon', 'Ready to play?'];

export const AI_NAMES = { rookie: 'Rookie', regular: 'Regular', shark: 'Shark' };
