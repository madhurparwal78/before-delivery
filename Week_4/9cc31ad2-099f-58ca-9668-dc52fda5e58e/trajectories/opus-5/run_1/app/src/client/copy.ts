import { formatThousands } from '../shared/format.js';

/** Every piece of visible copy, character for character. */
export const copy = {
  ageError: 'Confirm you are 13 or older to play.',
  starting: 'Starting…',
  verifying: 'Verifying run…',
  held: 'Held for verification',
  outageBanner:
    'Replay storage is unavailable. Runs are held and will verify when it returns.',
  ghostLoading: 'Ghost: loading',
  ghostUnavailable: 'Ghost unavailable. Racing without it.',
  startPrompt: 'Press Enter to start',
  buying: 'Buying…',
  refitting: 'Refitting…',
  notEnoughHeading: 'Not enough coins',
  unconfirmed:
    "We couldn't confirm the purchase. Nothing changes here until it is confirmed.",
  garageRefreshed: 'Garage refreshed from the server.',
  boardLoading: 'Loading times…',
  boardEmpty: 'No verified times on this board yet.',
  lobbyWaiting: 'Waiting for players',
  lobbyRacing: 'Racing',
  lobbyFinished: 'Finished',
  reconnecting: 'Reconnecting',
  lobbyFull: 'This lobby is full.',
  lobbyStarted: 'This lobby has already started.',
  clubLocked: 'Locked until the Rookie league is complete',
  leagueComplete: 'Complete',
  trophy: 'Club champion trophy',
  rookieCompleteAnnouncement:
    'Rookie league complete. Club league and Quarry Switchbacks unlocked.',
  clubCompleteAnnouncement: 'Club league complete. Trophy and 1,000 coins added.',
  sending: 'Sending…',
  emailInvalid: 'Enter a valid email address.',
  mailOutage: "We couldn't send the email right now. Try again in a minute.",
  signingIn: 'Signing you in…',
  linkExpired: 'This sign-in link has expired or was already used. Send a new one.',
  sendANewOne: 'Send a new one',
  webglNotice: '3D view needs WebGL 2. Showing a drawing instead.',
  desktopNotice: 'Racing needs a desktop browser with a keyboard.',
};

export const rejectionCopy: Record<string, string> = {
  did_not_finish: 'Rejected: the replay did not reach the finish.',
  seed_mismatch: "Rejected: the run's seed did not match.",
  invalid_inputs: 'Rejected: the inputs could not be read.',
};

export function verifiedCopy(result: string, coins: number): string {
  return `Verified: ${result}, +${formatThousands(coins)} coins`;
}

export function lapAnnouncement(lap: number, lapTime: string, valid: boolean): string {
  return valid ? `Lap ${lap}: ${lapTime}` : `Lap ${lap}: ${lapTime}, invalid`;
}

export function balanceCopy(balance: number): string {
  return `${formatThousands(balance)} coins`;
}

export function shortfallCopy(shortfall: number): string {
  return `You need ${formatThousands(shortfall)} more coins.`;
}

export function upgradeAnnouncement(
  system: string,
  stage: number,
  balance: number,
  summary: string,
): string {
  return `${system} stage ${stage} fitted. Balance: ${formatThousands(balance)} coins. ${summary}`;
}

export function refitAnnouncement(system: string, refund: number, balance: number): string {
  return `${system} refitted to stock. Refund: ${formatThousands(refund)} coins. Balance: ${formatThousands(balance)} coins.`;
}

export function carAnnouncement(carName: string, balance: number): string {
  return `${carName} added to your garage. Balance: ${formatThousands(balance)} coins.`;
}

export function piWarning(pi: number, carClass: string, limit: number): string {
  return `This upgrade takes PI to ${pi}, over the class ${carClass} limit of ${limit}. The car can no longer enter class ${carClass} events.`;
}

export function loanerCopy(carClass: string, carName: string): string {
  return `You have no eligible class ${carClass} car. Race the loaner ${carName} for half result coins?`;
}

export function signinSent(email: string): string {
  return `Check ${email} for your sign-in link.`;
}

export function signedIn(email: string): string {
  return `Signed in as ${email}. Your garage is saved.`;
}

export function countdownCopy(value: number): string {
  return `Starting in ${value}`;
}

export function graceCopy(seconds: number): string {
  return `Finish grace: ${seconds} s`;
}

export function leaguePointsCopy(points: number): string {
  return `${points} / 50 points`;
}

export function payoutCopy(coins: number): string {
  return `+${formatThousands(coins)} coins`;
}
