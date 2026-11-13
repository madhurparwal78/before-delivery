import {
  CALL_A_POCKET,
  EIGHT_ON_BREAK,
  FOUL_COPY,
  ILLEGAL_BREAK,
  LEGAL_NOTHING,
  WRONG_FIRST_NINE,
  ballInHandLine,
  groupClaimLine,
  potLine,
} from './copy.js';
import { FOOT_SPOT, HEAD_SPOT } from './table-geometry.js';
import type {
  Announcement,
  FoulKind,
  Group,
  MatchState,
  Pocket,
  Point,
  ResultCase,
  Ruling,
  Seat,
  ShotOutcome,
} from './types.js';

export function otherSeat(seat: Seat): Seat {
  return seat === 1 ? 2 : 1;
}

export function groupOf(ball: number): Exclude<Group, null> | null {
  if (ball === 8) return null;
  if (ball >= 1 && ball <= 7) return 'solids';
  if (ball >= 9 && ball <= 15) return 'stripes';
  return null;
}

export function countGroup(balls: number[], group: Group): number {
  if (!group) return 0;
  return balls.filter((ball) => groupOf(ball) === group).length;
}

export function lowestBall(balls: number[]): number | null {
  const sorted = [...balls].sort((a, b) => a - b);
  return sorted[0] ?? null;
}

/** `ballsLeft` as published for a seat. */
export function ballsLeft(state: MatchState, seat: Seat): number {
  if (state.mode === 'nine-ball') return state.balls.length;
  const group = state.groups[seat];
  if (!group) return state.balls.filter((ball) => ball !== 8).length;
  return countGroup(state.balls, group);
}

export function requiresCalledPocket(state: MatchState, seat: Seat): boolean {
  if (state.mode === 'nine-ball') return false;
  const group = state.groups[seat];
  if (!group) return false;
  return countGroup(state.balls, group) === 0 && state.balls.includes(8);
}

export function newMatchState(mode: MatchState['mode'], positions: Record<number, Point>, balls: number[]): MatchState {
  return {
    mode,
    phase: 'break',
    groups: { 1: null, 2: null },
    balls,
    activeSeat: 1,
    ballInHand: false,
    behindHeadString: false,
    calledPocketRequired: false,
    positions: { ...positions, 0: { ...HEAD_SPOT } },
    over: false,
  };
}

export interface ShotContext {
  state: MatchState;
  seat: Seat;
  outcome: ShotOutcome;
  calledPocket: Pocket | null;
  names: Record<Seat, string>;
  /** Rest positions for the object balls still on the table, plus 0 for the cue ball. */
  positions: Record<number, Point>;
  clockExpired?: boolean;
}

/**
 * The one place where a shot becomes a ruling: fouls, groups, turns and wins.
 * Used by the server for live tables and by practice and the tutorial in the browser.
 */
export function applyShot(context: ShotContext): Ruling {
  const { state, seat, outcome, calledPocket, names } = context;
  const opponent = otherSeat(seat);
  const nineBall = state.mode === 'nine-ball';
  const isBreak = state.phase === 'break';
  const shooterGroup = state.groups[seat];
  const groupClearedBefore = shooterGroup !== null && countGroup(state.balls, shooterGroup) === 0;

  const foul = rulingFoul(context, isBreak, nineBall, shooterGroup, groupClearedBefore);
  const pottedNonEight = outcome.pocketed.filter((entry) => entry.ball !== 8);
  const eightPotted = outcome.pocketed.some((entry) => entry.ball === 8);
  const ninePotted = outcome.pocketed.some((entry) => entry.ball === 9);

  const legalBreak = isBreak && foul === null && (outcome.pocketed.length > 0 || outcome.cushion);
  const illegalBreak = isBreak && !legalBreak;
  const eightOnBreak = isBreak && eightPotted && !illegalBreak;

  let balls = state.balls.filter((ball) => !outcome.pocketed.some((entry) => entry.ball === ball));
  balls = balls.filter((ball) => !outcome.offTable.includes(ball));
  const positions: Record<number, Point> = { ...context.positions };
  const respot = (ball: number): void => {
    if (!balls.includes(ball)) balls.push(ball);
    positions[ball] = { ...FOOT_SPOT };
  };
  for (const ball of outcome.offTable) {
    if (ball !== 0) respot(ball);
  }

  let winnerSeat: Seat | null = null;
  let resultCase: ResultCase | null = null;

  if (nineBall) {
    if (ninePotted && foul === null) {
      winnerSeat = seat;
      resultCase = 'nine';
    } else if (ninePotted) {
      respot(9);
    }
  } else if (eightPotted) {
    if (eightOnBreak) {
      respot(8);
    } else if (illegalBreak) {
      respot(8);
    } else if (foul === 'scratch') {
      winnerSeat = opponent;
      resultCase = 'scratch-on-8';
    } else if (foul !== null) {
      winnerSeat = opponent;
      resultCase = 'foul-on-8';
    } else if (!groupClearedBefore) {
      winnerSeat = opponent;
      resultCase = 'early';
    } else if (calledPocket === null || !potOfEightMatches(outcome, calledPocket)) {
      winnerSeat = opponent;
      resultCase = 'uncalled';
    } else {
      winnerSeat = seat;
      resultCase = 'called';
    }
  }

  let groups: { 1: Group; 2: Group } = { ...state.groups };
  let claim: { seat: Seat; group: Exclude<Group, null> } | null = null;
  if (!nineBall && state.phase === 'open' && foul === null && pottedNonEight.length > 0) {
    const first = pottedNonEight[0];
    const claimed = first ? groupOf(first.ball) : null;
    if (claimed) {
      claim = { seat, group: claimed };
      groups = seat === 1 ? { 1: claimed, 2: claimed === 'solids' ? 'stripes' : 'solids' } : { 1: claimed === 'solids' ? 'stripes' : 'solids', 2: claimed };
    }
  }

  let phase = state.phase;
  if (isBreak) phase = 'open';
  if (claim) phase = 'groups';

  let keepsTurn: boolean;
  if (foul !== null) keepsTurn = false;
  else if (nineBall) keepsTurn = outcome.pocketed.length > 0;
  else if (isBreak) keepsTurn = outcome.pocketed.length > 0;
  else if (claim) keepsTurn = true;
  else if (shooterGroup) {
    keepsTurn = pottedNonEight.some((entry) => groupOf(entry.ball) === shooterGroup);
  } else keepsTurn = pottedNonEight.length > 0;

  const over = winnerSeat !== null;
  const activeSeat: Seat = over ? state.activeSeat : keepsTurn ? seat : opponent;
  const ballInHand = !over && foul !== null;
  const behindHeadString = ballInHand && illegalBreak;
  if (outcome.scratch || outcome.offTable.includes(0)) {
    positions[0] = behindHeadString ? { ...HEAD_SPOT } : { ...HEAD_SPOT };
  }

  const nextState: MatchState = {
    mode: state.mode,
    phase,
    groups,
    balls,
    activeSeat,
    ballInHand,
    behindHeadString,
    calledPocketRequired: false,
    positions,
    over,
  };
  nextState.calledPocketRequired = !over && requiresCalledPocket(nextState, activeSeat);

  const announcements: Announcement[] = [];
  const plain = (text: string): void => {
    announcements.push({ type: 'plain', text });
  };

  if (outcome.pocketed.length > 0) {
    for (const entry of outcome.pocketed) plain(potLine(entry.ball, entry.pocket));
  } else if (foul === null) {
    plain(LEGAL_NOTHING);
  }

  let claimAnnouncement: Announcement | null = null;
  if (claim) {
    claimAnnouncement = { type: 'plain', text: groupClaimLine(names[claim.seat], claim.group) };
    announcements.push(claimAnnouncement);
  }

  let verdict: Announcement | null = null;
  if (illegalBreak) {
    verdict = { type: 'plain', text: ILLEGAL_BREAK };
  } else if (eightOnBreak) {
    verdict = { type: 'plain', text: EIGHT_ON_BREAK };
  } else if (foul !== null) {
    verdict = { type: 'plain', text: foulSentence(foul, nineBall) };
  }
  if (verdict) announcements.push(verdict);

  if (!over && ballInHand) plain(ballInHandLine(names[activeSeat]));
  if (!over && nextState.calledPocketRequired) plain(CALL_A_POCKET);
  if (!over && (activeSeat !== state.activeSeat || ballInHand !== state.ballInHand)) {
    announcements.push({ type: 'turn', seat: activeSeat, ballInHand });
  }
  if (over) {
    announcements.push({ type: 'game-over' });
    announcements.push({ type: 'result', winnerSeat, resultCase: resultCase as ResultCase });
  }

  const banner = pickBanner({
    over,
    winnerSeat,
    resultCase,
    foul,
    illegalBreak,
    eightOnBreak,
    calledPocketRequired: nextState.calledPocketRequired,
    claim: claimAnnouncement,
    pocketed: outcome.pocketed,
    nineBall,
  });

  return {
    announcements,
    banner,
    foul,
    illegalBreak,
    eightOnBreak,
    winnerSeat,
    resultCase,
    state: nextState,
  };
}

function potOfEightMatches(outcome: ShotOutcome, calledPocket: Pocket): boolean {
  const entry = outcome.pocketed.find((item) => item.ball === 8);
  return entry ? entry.pocket === calledPocket : false;
}

export function foulSentence(foul: FoulKind, nineBall: boolean): string {
  if (foul === 'wrong-first' && nineBall) return WRONG_FIRST_NINE;
  return FOUL_COPY[foul];
}

function rulingFoul(
  context: ShotContext,
  isBreak: boolean,
  nineBall: boolean,
  shooterGroup: Group,
  groupClearedBefore: boolean,
): FoulKind | null {
  const { outcome } = context;
  if (context.clockExpired) return 'clock';
  if (outcome.scratch || outcome.offTable.includes(0)) return 'scratch';
  if (outcome.offTable.length > 0) return 'off-table';
  if (outcome.firstContact === null) return 'no-contact';
  if (!legalFirstContact(context, isBreak, nineBall, shooterGroup, groupClearedBefore)) return 'wrong-first';
  if (outcome.pocketed.length === 0 && !outcome.cushion) return 'no-cushion';
  return null;
}

function legalFirstContact(
  context: ShotContext,
  isBreak: boolean,
  nineBall: boolean,
  shooterGroup: Group,
  groupClearedBefore: boolean,
): boolean {
  const first = context.outcome.firstContact;
  if (first === null) return false;
  if (nineBall) return first === lowestBall(context.state.balls);
  if (isBreak) return true;
  if (context.state.phase === 'open') return first !== 8;
  if (!shooterGroup) return first !== 8;
  if (groupClearedBefore) return first === 8;
  return groupOf(first) === shooterGroup;
}

function pickBanner(input: {
  over: boolean;
  winnerSeat: Seat | null;
  resultCase: ResultCase | null;
  foul: FoulKind | null;
  illegalBreak: boolean;
  eightOnBreak: boolean;
  calledPocketRequired: boolean;
  claim: Announcement | null;
  pocketed: { ball: number; pocket: Pocket }[];
  nineBall: boolean;
}): Announcement | null {
  if (input.over && input.resultCase) {
    return { type: 'result', winnerSeat: input.winnerSeat, resultCase: input.resultCase };
  }
  if (input.foul !== null && !input.illegalBreak) {
    return { type: 'plain', text: foulSentence(input.foul, input.nineBall) };
  }
  if (input.illegalBreak) return { type: 'plain', text: ILLEGAL_BREAK };
  if (input.eightOnBreak) return { type: 'plain', text: EIGHT_ON_BREAK };
  if (input.calledPocketRequired) return { type: 'plain', text: CALL_A_POCKET };
  if (input.claim) return input.claim;
  const last = input.pocketed[input.pocketed.length - 1];
  if (last) return { type: 'plain', text: potLine(last.ball, last.pocket) };
  return { type: 'plain', text: LEGAL_NOTHING };
}
