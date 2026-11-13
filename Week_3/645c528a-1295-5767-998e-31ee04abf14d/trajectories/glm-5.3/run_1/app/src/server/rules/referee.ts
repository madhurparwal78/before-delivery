import type { Mode, PocketName } from '../../shared/types.js';
import { copy } from '../copy.js';
import type { Ball, TableState, TraceResult } from './physics.js';
import { groupOf, lowestBall, otherGroup } from './physics.js';

export type FoulKind =
  | 'scratch'
  | 'wrong_contact'
  | 'no_contact'
  | 'no_cushion'
  | 'off_table'
  | 'clock'
  | null;

export interface RefereeInput {
  seat: 1 | 2;
  isBreak: boolean;
  calledPocket: PocketName | null;
  trace: TraceResult;
  power: number;
  mode: Mode;
}

export interface Ruling {
  foul: FoulKind;
  foulSentence: string | null;
  illegalBreak: boolean;
  eightOnBreak: boolean;
  groupClaim: 'solids' | 'stripes' | null;
  groupClaimSeat: 1 | 2 | null;
  potLines: string[];
  keepTurn: boolean;
  ballInHandTo: 1 | 2 | null;
  behindHeadString: boolean;
  win: 'shooter' | 'opponent' | null;
  loseReason: 'scratch8' | 'foul8' | 'early8' | 'uncalled' | null;
  eightReSpot: boolean;
  offTableRespots: number[];
  banner: string | null;
}

const FOUL_ORDER: Exclude<FoulKind, null>[] = ['scratch', 'off_table', 'no_contact', 'wrong_contact', 'no_cushion'];

const FOUL_SENTENCES = { scratch: copy.foulScratch, off_table: copy.foulOffTable, no_contact: copy.foulNoContact, wrong_contact: copy.foulWrongGroup, no_cushion: copy.foulNoCushion, clock: copy.foulClock } as const;

export function firstFoulReasons(flags: { scratch: boolean; offTable: boolean; noContact: boolean; wrongContact: boolean; noCushion: boolean }): FoulKind {
  const map: Record<Exclude<FoulKind, null>, boolean> = {
    scratch: flags.scratch,
    off_table: flags.offTable,
    no_contact: flags.noContact,
    wrong_contact: flags.wrongContact,
    no_cushion: flags.noCushion,
    clock: false,
  };
  for (const kind of FOUL_ORDER) {
    if (map[kind]) return kind;
  }
  return null;
}

export function foulSentence(kind: Exclude<FoulKind, null>, mode: Mode): string {
  if (kind === 'wrong_contact' && mode === 'nine-ball') return copy.foulWrongNine;
  return FOUL_SENTENCES[kind];
}

/**
 * The referee decides everything about one shot: fouls, pots, groups, turns,
 * ball in hand and the win or loss. Nothing else in the source decides a ruling.
 */
export function referee(state: TableState, input: RefereeInput): Ruling {
  const { trace, seat, isBreak, mode } = input;
  const opponent = (seat === 1 ? 2 : 1) as 1 | 2;
  const pocketed = trace.pocketed;
  const pottedEight = pocketed.some((p) => p.ball === 8);
  const pottedNine = pocketed.some((p) => p.ball === 9);
  const shooterGroup = seat === 1 ? state.groups[1] : state.groups[2];

  let scratch = trace.cueScratch || trace.offTable.includes(0);
  const noContact = trace.firstContact === null;
  const offTable = trace.offTable.filter((n) => n !== 0);
  let respots: number[] = [];

  // Break handling.
  if (isBreak) {
    const ballsToRails = trace.cushionAfterContact || pocketed.length > 0 || trace.cushionFirst;
    const legalBreak = pocketed.length > 0 || ballsToRails;
    const anyFoul = scratch || offTable.length > 0 || noContact || trace.cushionFirst && pocketed.length === 0 && false;
    void anyFoul;
    const fouled = scratch || offTable.length > 0 || noContact;
    if (pottedEight) {
      if (fouled || !legalBreak) {
        return finishBreakFoul(state, input, scratch, offTable, respots);
      }
      return {
        foul: null,
        foulSentence: null,
        illegalBreak: false,
        eightOnBreak: true,
        groupClaim: null,
        groupClaimSeat: null,
        potLines: [],
        keepTurn: true,
        ballInHandTo: null,
        behindHeadString: false,
        win: null,
        loseReason: null,
        eightReSpot: true,
        offTableRespots: offTable,
        banner: copy.eightOnBreak,
      };
    }
    if (!legalBreak || fouled) {
      return finishBreakFoul(state, input, scratch, offTable, respots);
    }
    // Legal break.
    const potLines = pocketed.map((p) => copy.potted(p.ball, p.pocket));
    const keepTurn = pocketed.length > 0;
    return {
      foul: null,
      foulSentence: null,
      illegalBreak: false,
      eightOnBreak: false,
      groupClaim: null,
      groupClaimSeat: null,
      potLines,
      keepTurn,
      ballInHandTo: null,
      behindHeadString: false,
      win: null,
      loseReason: null,
      eightReSpot: false,
      offTableRespots: respots,
      banner: potLines[potLines.length - 1] ?? (keepTurn ? null : null),
    };
  }

  // Wrong first contact.
  let wrongContact = false;
  if (mode === 'nine-ball') {
    const lowest = lowestBall(state);
    wrongContact = trace.firstContact !== null && lowest !== null && trace.firstContact !== lowest;
  } else if (state.phase === 'open') {
    wrongContact = trace.firstContact === 8;
  } else if (shooterGroup) {
    const groupCleared = shooterGroup === 'solids'
      ? !state.balls.some((b) => groupOf(b.number) === 'solids')
      : !state.balls.some((b) => groupOf(b.number) === 'stripes');
    if (groupCleared) {
      wrongContact = trace.firstContact !== 8;
    } else {
      wrongContact = trace.firstContact === null ? false : groupOf(trace.firstContact) !== shooterGroup;
    }
  }

  const noCushion = trace.firstContact !== null && !trace.cushionAfterContact && pocketed.length === 0;
  const foul = firstFoulReasons({ scratch, offTable: offTable.length > 0, noContact, wrongContact, noCushion });

  // 9-Ball: the 9 on a foul is re-spotted, and the 9 on a legal shot wins.
  if (mode === 'nine-ball') {
    if (pottedNine && foul === null) {
      return {
        foul: null,
        foulSentence: null,
        illegalBreak: false,
        eightOnBreak: false,
        groupClaim: null,
        groupClaimSeat: null,
        potLines: pocketed.filter((p) => p.ball !== 9).map((p) => copy.potted(p.ball, p.pocket)),
        keepTurn: true,
        ballInHandTo: null,
        behindHeadString: false,
        win: 'shooter',
        loseReason: null,
        eightReSpot: false,
        offTableRespots: respots,
        banner: null,
      };
    }
    if (pottedNine && foul !== null) {
      respots = [9];
    }
    return continueRuling(state, input, foul, scratch, offTable, respots, pocketed, true);
  }

  // 8-ball outcomes when the shooter's group is cleared (or the 8 falls on any shot).
  if (pottedEight) {
    const groupCleared = shooterGroup !== null && !state.balls.some((b) => groupOf(b.number) === shooterGroup && b.number !== 8);
    if (state.phase === 'open' || shooterGroup === null || !groupCleared) {
      // 8 early.
      return {
        foul: null,
        foulSentence: null,
        illegalBreak: false,
        eightOnBreak: false,
        groupClaim: null,
        groupClaimSeat: null,
        potLines: pocketed.filter((p) => p.ball !== 8).map((p) => copy.potted(p.ball, p.pocket)),
        keepTurn: false,
        ballInHandTo: null,
        behindHeadString: false,
        win: 'opponent',
        loseReason: 'early8',
        eightReSpot: false,
        offTableRespots: respots,
        banner: null,
      };
    }
    const legal = foul === null;
    const called = input.calledPocket !== null;
    const inCalledPocket = called && pocketed.some((p) => p.ball === 8 && p.pocket === input.calledPocket);
    if (legal && inCalledPocket) {
      return {
        foul: null,
        foulSentence: null,
        illegalBreak: false,
        eightOnBreak: false,
        groupClaim: null,
        groupClaimSeat: null,
        potLines: pocketed.map((p) => copy.potted(p.ball, p.pocket)),
        keepTurn: false,
        ballInHandTo: null,
        behindHeadString: false,
        win: 'shooter',
        loseReason: null,
        eightReSpot: false,
        offTableRespots: respots,
        banner: null,
      };
    }
    if (scratch) {
      return {
        foul: null,
        foulSentence: null,
        illegalBreak: false,
        eightOnBreak: false,
        groupClaim: null,
        groupClaimSeat: null,
        potLines: pocketed.filter((p) => p.ball !== 8).map((p) => copy.potted(p.ball, p.pocket)),
        keepTurn: false,
        ballInHandTo: null,
        behindHeadString: false,
        win: 'opponent',
        loseReason: 'scratch8',
        eightReSpot: false,
        offTableRespots: respots,
        banner: null,
      };
    }
    if (!legal) {
      return {
        foul,
        foulSentence: foulSentence(foul as Exclude<FoulKind, null>, mode),
        illegalBreak: false,
        eightOnBreak: false,
        groupClaim: null,
        groupClaimSeat: null,
        potLines: pocketed.filter((p) => p.ball !== 8).map((p) => copy.potted(p.ball, p.pocket)),
        keepTurn: false,
        ballInHandTo: null,
        behindHeadString: false,
        win: 'opponent',
        loseReason: 'foul8',
        eightReSpot: false,
        offTableRespots: respots,
        banner: null,
      };
    }
    // Legal but not in the called pocket.
    return {
      foul: null,
      foulSentence: null,
      illegalBreak: false,
      eightOnBreak: false,
      groupClaim: null,
      groupClaimSeat: null,
      potLines: pocketed.filter((p) => p.ball !== 8).map((p) => copy.potted(p.ball, p.pocket)),
      keepTurn: false,
      ballInHandTo: null,
      behindHeadString: false,
      win: 'opponent',
      loseReason: 'uncalled',
      eightReSpot: false,
      offTableRespots: respots,
      banner: null,
    };
  }

  return continueRuling(state, input, foul, scratch, offTable, respots, pocketed, false);
}

function finishBreakFoul(state: TableState, input: RefereeInput, scratch: boolean, offTable: number[], respots: number[]): Ruling {
  void state;
  return {
    foul: null,
    foulSentence: null,
    illegalBreak: true,
    eightOnBreak: false,
    groupClaim: null,
    groupClaimSeat: null,
    potLines: input.trace.pocketed.filter((p) => p.ball !== 8).map((p) => copy.potted(p.ball, p.pocket)),
    keepTurn: false,
    ballInHandTo: (input.seat === 1 ? 2 : 1) as 1 | 2,
    behindHeadString: true,
    win: null,
    loseReason: null,
    eightReSpot: input.trace.pocketed.some((p) => p.ball === 8),
    offTableRespots: [...respots, ...offTable, ...(input.trace.pocketed.some((p) => p.ball === 8) ? [8] : [])],
    banner: copy.illegalBreak,
  };
}

function continueRuling(
  state: TableState,
  input: RefereeInput,
  foul: FoulKind,
  scratch: boolean,
  offTable: number[],
  respots: number[],
  pocketed: { ball: number; pocket: PocketName }[],
  nineBallMode: boolean
): Ruling {
  const seat = input.seat;
  const shooterGroup = seat === 1 ? state.groups[1] : state.groups[2];
  let groupClaim: 'solids' | 'stripes' | null = null;
  let groupClaimSeat: 1 | 2 | null = null;
  const potLines = pocketed.map((p) => copy.potted(p.ball, p.pocket));

  // Open table: first legal pot claims the group; scratch or other foul leaves it open.
  if (!nineBallMode && state.phase === 'open' && foul === null && pocketed.length > 0) {
    const first = pocketed[0];
    const group = groupOf(first.ball);
    if (group !== null) {
      groupClaim = group;
      groupClaimSeat = seat;
    }
  }

  let keepTurn = false;
  if (foul === null && pocketed.length > 0) {
    if (nineBallMode) {
      keepTurn = true;
    } else if (groupClaim !== null) {
      keepTurn = true;
    } else if (shooterGroup !== null) {
      keepTurn = pocketed.some((p) => groupOf(p.ball) === shooterGroup);
    } else {
      keepTurn = true; // open table, any ball potted legally keeps the turn
    }
  }

  const ballInHandTo = foul !== null ? ((seat === 1 ? 2 : 1) as 1 | 2) : null;
  const behindHeadString = false;

  return {
    foul,
    foulSentence: foul !== null ? foulSentence(foul, input.mode) : null,
    illegalBreak: false,
    eightOnBreak: false,
    groupClaim,
    groupClaimSeat,
    potLines,
    keepTurn,
    ballInHandTo,
    behindHeadString,
    win: null,
    loseReason: null,
    eightReSpot: false,
    offTableRespots: [...respots, ...offTable],
    banner: null,
  };
}

export function reSpot(balls: Ball[], numbers: number[]): Ball[] {
  const out = balls.map((b) => ({ ...b }));
  for (const number of numbers) {
    if (out.some((b) => b.number === number)) continue;
    out.push({ number, across: 50, along: 50 });
  }
  return out;
}

export function reSpotEight(): Ball {
  return { number: 8, across: 50, along: 50 };
}

export function calledPocketRequiredFor(state: TableState, seat: 1 | 2): boolean {
  if (state.mode === 'nine-ball') return false;
  const shooterGroup = seat === 1 ? state.groups[1] : state.groups[2];
  if (state.phase !== 'groups' || shooterGroup === null) return false;
  return !state.balls.some((b) => groupOf(b.number) === shooterGroup && b.number !== 8);
}

export function resultLines(mode: Mode, reason: 'win8called' | 'win8early' | 'win8uncalled' | 'win8scratch' | 'win8foul' | 'win9' | 'forfeit', opponentName: string): { winner: string; loser: string } {
  switch (reason) {
    case 'win8called': return { winner: copy.result8CalledWin, loser: copy.result8CalledLose(opponentName) };
    case 'win8early': return { winner: copy.result8EarlyWin(opponentName), loser: copy.result8EarlyLose };
    case 'win8uncalled': return { winner: copy.resultUncalledWin(opponentName), loser: copy.resultUncalledLose };
    case 'win8scratch': return { winner: copy.resultScratch8Win(opponentName), loser: copy.resultScratch8Lose };
    case 'win8foul': return { winner: copy.resultFoul8Win(opponentName), loser: copy.resultFoul8Lose };
    case 'win9': return { winner: copy.resultNineWin, loser: copy.resultNineLose(opponentName) };
    case 'forfeit': return { winner: copy.resultForfeitWin(opponentName), loser: copy.resultForfeitLose };
  }
}
