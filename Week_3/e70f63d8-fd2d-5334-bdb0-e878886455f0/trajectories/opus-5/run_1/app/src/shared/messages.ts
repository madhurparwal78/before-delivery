import type { Extra, WicketKind } from './types.js';

/** Rounds `num / den` to `dp` decimals, half away from zero, using integer arithmetic. */
export function ratioFixed(num: number, den: number, dp: number): string {
  if (den === 0) return '-';
  const sign = num < 0 !== den < 0 ? -1 : 1;
  const n = Math.abs(num) * 10 ** dp;
  const d = Math.abs(den);
  const q = Math.floor((2 * n + d) / (2 * d));
  const whole = Math.floor(q / 10 ** dp);
  const frac = q - whole * 10 ** dp;
  const body = dp === 0 ? String(whole) : `${whole}.${String(frac).padStart(dp, '0')}`;
  return sign < 0 && q !== 0 ? `-${body}` : body;
}

export function signedFixed(num: number, den: number, dp: number): string {
  const text = ratioFixed(num, den, dp);
  if (text === '-') return '0.000';
  if (text.startsWith('-')) return text;
  const zero = `0.${'0'.repeat(dp)}`;
  return text === zero ? zero : `+${text}`;
}

export function oversText(legalBalls: number): string {
  const completed = Math.floor(legalBalls / 6);
  const rem = legalBalls % 6;
  return rem === 0 ? String(completed) : `${completed}.${rem}`;
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

const BAT_WORDS = ['no run', '1 run', '2 runs', '3 runs', 'FOUR', '5 runs', 'SIX'];

export function runsPart(extra: Extra, runs: number): string {
  switch (extra) {
    case 'none':
      return BAT_WORDS[runs];
    case 'wide':
      return plural(1 + runs, 'wide', 'wides');
    case 'no-ball':
      return `no-ball, ${BAT_WORDS[runs]}`;
    case 'bye':
      return plural(runs, 'bye', 'byes');
    case 'leg-bye':
      return plural(runs, 'leg bye', 'leg byes');
  }
}

export function deliveryLine(args: {
  label: string;
  bowler: string;
  striker: string;
  extra: Extra;
  runs: number;
  dismissal: string | null;
  freeHit: boolean;
}): string {
  const part = runsPart(args.extra, args.runs);
  let line = `${args.label} ${args.bowler} to ${args.striker},`;
  if (!(part === 'no run' && args.dismissal)) line += ` ${part}`;
  if (args.dismissal) line += `${part === 'no run' ? '' : ','} OUT! ${args.dismissal}`;
  if (args.freeHit) line += ' (free hit)';
  return line;
}

export function overEndLine(args: {
  over: number;
  runsInOver: number;
  team: string;
  runs: number;
  wickets: number;
}): string {
  return `End of over ${args.over}: ${plural(args.runsInOver, 'run', 'runs')}. ${args.team} ${args.runs}/${args.wickets}`;
}

export function retirementLine(short: string): string {
  return `${short} retired hurt`;
}

export function totalShort(runs: number, wickets: number, allOut: boolean): string {
  return allOut ? `${runs} all out` : `${runs}/${wickets}`;
}

export function breakText(args: {
  team: string;
  total: string;
  overs: string;
  chasing: string;
  target: number;
  balls: number;
}): string {
  return `${args.team} ${args.total} (${args.overs} ov). ${args.chasing} need ${plural(args.target, 'run', 'runs')} from ${plural(args.balls, 'ball', 'balls')}.`;
}

export const INNINGS_BREAK_HEADING = 'Innings break';

export function superOverHeading(n: number): string {
  return `Super over ${n}`;
}

export function superOverStartText(team: string, n: number): string {
  return `Scores level. ${team} bat first in super over ${n}.`;
}

export function chaseText(need: number, balls: number, rate: string): string {
  return `Need ${need} from ${plural(balls, 'ball', 'balls')}. Required rate ${rate}`;
}

export function resultByWickets(team: string, wickets: number, balls: number): string {
  const head = `${team} won by ${plural(wickets, 'wicket', 'wickets')}`;
  return balls === 0 ? head : `${head} (${plural(balls, 'ball left', 'balls left')})`;
}

export function resultByRuns(team: string, runs: number): string {
  return `${team} won by ${plural(runs, 'run', 'runs')}`;
}

export function resultSuperOver(team: string): string {
  return `${team} won the super over`;
}

export const RESULT_TIED = 'Match tied';

export function resultTiedAfterSuperOvers(n: number): string {
  return `Match tied after ${n} super overs`;
}

export function deliveryAnnouncement(args: {
  line: string;
  team: string;
  runs: number;
  wickets: number;
  overEndLine: string | null;
  breakText: string | null;
  result: string | null;
}): string {
  let text = `${args.line}. ${args.team} ${args.runs}/${args.wickets}.`;
  if (args.overEndLine) {
    const first = args.overEndLine.split('. ')[0];
    text += ` ${first}.`;
  }
  if (args.result) text += ` ${args.result}.`;
  else if (args.breakText) text += ` ${args.breakText}`;
  return text;
}

export function retirementAnnouncement(args: {
  short: string;
  team: string;
  runs: number;
  wickets: number;
}): string {
  return `${args.short} retired hurt. ${args.team} ${args.runs}/${args.wickets}.`;
}

export function runRateText(value: string): string {
  return `Run rate ${value}`;
}

export function bowlerFigures(args: {
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
}): string {
  return `${args.overs}-${args.maidens}-${args.runs}-${args.wickets}`;
}

export function extrasText(e: { b: number; lb: number; w: number; nb: number; total: number }): string {
  return `Extras ${e.total} (b ${e.b}, lb ${e.lb}, w ${e.w}, nb ${e.nb})`;
}

export function totalText(runs: number, wickets: number, allOut: boolean, overs: string): string {
  return `Total ${totalShort(runs, wickets, allOut)} (${overs} ov)`;
}

export function didNotBatText(shorts: string[]): string {
  return `Did not bat: ${shorts.join(', ')}`;
}

export function fallOfWicketsText(entries: { w: number; runs: number; short: string; label: string }[]): string {
  if (entries.length === 0) return 'Fall of wickets: none';
  return `Fall of wickets: ${entries.map((e) => `${e.w}-${e.runs} (${e.short}, ${e.label})`).join(', ')}`;
}

export const DISMISSAL_NOT_OUT = 'not out';
export const DISMISSAL_RETIRED_HURT = 'retired hurt';

export function dismissalText(args: {
  kind: WicketKind;
  fielder: string | null;
  bowler: string;
}): string {
  switch (args.kind) {
    case 'bowled':
      return `b ${args.bowler}`;
    case 'caught':
      return args.fielder === args.bowler ? `c & b ${args.bowler}` : `c ${args.fielder} b ${args.bowler}`;
    case 'lbw':
      return `lbw b ${args.bowler}`;
    case 'stumped':
      return `st ${args.fielder} b ${args.bowler}`;
    case 'hit-wicket':
      return `hit wicket b ${args.bowler}`;
    case 'run-out':
      return `run out (${args.fielder})`;
  }
}

export function chipText(args: {
  extra: Extra;
  runs: number;
  wicket: boolean;
}): string {
  let chip: string;
  switch (args.extra) {
    case 'none':
      chip = String(args.runs);
      break;
    case 'wide':
      chip = `${1 + args.runs}wd`;
      break;
    case 'no-ball':
      chip = `${1 + args.runs}nb`;
      break;
    case 'bye':
      chip = `${args.runs}b`;
      break;
    case 'leg-bye':
      chip = `${args.runs}lb`;
      break;
  }
  if (args.wicket) chip = chip === '0' ? 'W' : `${chip}W`;
  return chip;
}

export function scoreboardText(team: string, runs: number, wickets: number, overs: string): string {
  return `${team} ${runs}/${wickets} (${overs} ov)`;
}

export function batterText(short: string, onStrike: boolean, runs: number, balls: number): string {
  return `${short}${onStrike ? '*' : ''} ${runs} (${balls})`;
}

/** The single home of every other published sentence. */
export const MSG = {
  byesNeedRuns: 'Byes need at least 1 run.',
  needsBowler: 'Choose the next bowler first.',
  needsInnings: 'Start the innings first.',
  inningsOver: 'This innings is over.',
  matchOver: 'This match is over.',
  overInProgress: 'This over has already started.',
  inningsInProgress: 'This innings has already started.',
  freeHitWicket: 'Free hit: only a run out can dismiss a batter.',
  wicketNotAllowed: (kind: string) => `A ${kind} cannot happen on this delivery.`,
  bowlerConsecutive: (short: string) => `${short} bowled the last over.`,
  bowlerLimit: (short: string, limit: number) => `${short} has bowled ${limit} of ${limit} overs.`,
  bowlerSuperOver: (short: string) => `${short} bowled in the last super over.`,
  newBatterInvalid: 'Choose a batter who is waiting to bat.',
  noBatterLeft: 'No batter is left to come in.',
  changeMovesOvers: 'That change would move the overs. Undo back to this delivery instead.',
  changeBreaksLaterWicket: (seq: number, kind: string) =>
    `That change would make delivery ${seq} a free hit, and its wicket (${kind}) cannot happen on a free hit.`,
  changeBreaksWicket: (kind: string) => `That change would make its wicket (${kind}) impossible.`,
  changeSaved: (seq: number) => `Delivery ${seq} changed. Innings recalculated.`,
  undid: (seq: number) => `Undid delivery ${seq}.`,
  undidRetirement: (short: string) => `Undid the retirement of ${short}.`,
  nothingToUndo: 'Nothing to undo in this innings.',
  viewerChanged: (seq: number) => `The scorer changed delivery ${seq}.`,
  viewerUndid: (seq: number) => `The scorer undid delivery ${seq}.`,
  staleDelivery: 'The score has moved on. Showing the latest.',
  notSaved: 'That ball was not saved. Check your connection and try again.',
  penHeld: (holder: string) => `${holder} is scoring this match. You are viewing it read-only.`,
  penFree: 'No one is scoring this match.',
  invitationSent: (email: string) => `Invitation sent to ${email}.`,
  invitationMailLine: (hours: number) => `This invitation works once and expires after ${hours} hours.`,
  invitationUsed: 'This invitation has already been used.',
  invitationExpired: 'This invitation has expired.',
  invitationRateLimit: 'Too many invitations. Try again later.',
  mailOutage: 'The invitation could not be sent. Try again later.',
  logoUploading: 'Uploading logo',
  logoUploaded: 'Logo updated.',
  logoWrongType: 'Logo must be a PNG or JPEG image.',
  logoTooLarge: (maxBytes: number) => `Logo must be ${withThousands(maxBytes)} bytes or smaller.`,
  storageOutage: 'Logo storage is unavailable. The team keeps its previous logo.',
  liveOutageViewer: 'Live updates are paused. Reload for the latest score.',
  liveOutageScoring: 'Live updates are paused. Scoring still saves.',
  viewerLinkOff: 'This match is no longer shared.',
  pointsTableUpdated: 'Points table updated.',
  notFound: 'Not found.',
  signInFailed: 'Email or password is wrong.',
  signInRequired: 'Sign in to continue.',
  fieldErrors: 'Check the highlighted fields.',
  emailField: 'Enter a valid email address.',
  emailTaken: 'An account with this email already exists.',
  passwordField: 'Password must be at least 10 characters.',
  nameField: 'Enter a name.',
  shortNameClash: 'Short names must be unique within a team.',
  oversField: 'Overs must be a whole number from 1 to 50.',
  playersPerSideField: 'Players per side must be a whole number from 2 to 11.',
  xiField: (playersPerSide: number) => `Pick exactly ${playersPerSide} players from each team.`,
  tournamentGroupField: 'Both teams must be in the same group of this tournament.',
  runsField: 'Runs must be a whole number from 0 to 6.',
  emptyFixtures: 'No fixtures yet',
  emptyTeams: 'No teams yet',
  emptyTournaments: 'No tournaments yet',
  emptyPlayers: 'No players yet',
  serverError: 'Something went wrong. Try again.',
} as const;

export function withThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats an ISO date (YYYY-MM-DD) as `D Mon YYYY`. */
export function dateText(iso: string): string {
  const [y, m, d] = iso.split('-').map((part) => Number(part));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
