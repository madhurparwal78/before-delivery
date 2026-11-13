/** The referee: every foul, turn, group, ruling and win or loss reason is decided here, for online and practice alike. */
import { pocketName, type Mode, type Pocket } from './domain';

export type Seat = 1 | 2;
export type Group = 'solids' | 'stripes';
export type Phase = 'break' | 'open' | 'groups';

export interface Rack {
  mode: Mode;
  phase: Phase;
  groups: Record<Seat, Group | null>;
  balls: number[];
  activeSeat: Seat;
  ballInHand: boolean;
  behindHeadString: boolean;
}

export interface PottedBall {
  ball: number;
  pocket: Pocket;
}

export interface ShotOutcome {
  firstContact: number | null;
  pocketed: PottedBall[];
  cushion: boolean;
  scratch: boolean;
  offTable: number[];
}

type WinReason = 'called' | 'early' | 'uncalled' | 'scratch' | 'foul' | 'forfeit' | 'nine';

export interface Win {
  seat: Seat;
  reason: WinReason;
}

export interface Ruling {
  next: Rack;
  potLines: string[];
  legalLine: string | null;
  claim: string | null;
  foul: string | null;
  illegalBreak: string | null;
  eightOnBreak: string | null;
  ballInHandHolder: Seat | null;
  win: Win | null;
}

export type SeatNames = Record<Seat, string>;

export const CALL_POCKET = 'Call a pocket before you shoot.';
const FOUL_SCRATCH = 'Foul: cue ball scratched.';
const FOUL_WRONG_GROUP = 'Foul: first contact was not your group.';
const FOUL_WRONG_LOWEST = 'Foul: first contact was not the lowest ball.';
const FOUL_NO_CONTACT = 'Foul: cue ball hit nothing.';
const FOUL_NO_CUSHION = 'Foul: no ball reached a cushion after contact.';
const FOUL_OFF_TABLE = 'Foul: ball left the table.';
const FOUL_CLOCK = 'Foul: shot clock expired.';
const ILLEGAL_BREAK = 'Illegal break: opponent gets ball in hand behind the head string.';
const EIGHT_ON_BREAK = '8 on the break: re-spotted, shooter continues.';
const LEGAL_NOTHING = 'Legal shot: nothing potted.';
export const BEHIND_HEAD_STRING = 'Place the ball behind the head string.';
export const VOID_LINE = 'Match voided: both entries returned.';

export function otherSeat(seat: Seat): Seat {
  return seat === 1 ? 2 : 1;
}

export function groupOf(ball: number): Group | null {
  if (ball >= 1 && ball <= 7) return 'solids';
  if (ball >= 9 && ball <= 15) return 'stripes';
  return null;
}

function groupCleared(rack: Rack, seat: Seat): boolean {
  const group = rack.groups[seat];
  return group !== null && !rack.balls.some((ball) => groupOf(ball) === group);
}

export function calledPocketRequired(rack: Rack): boolean {
  return rack.mode !== 'nine-ball' && groupCleared(rack, rack.activeSeat);
}

export function ballsLeft(rack: Rack, seat: Seat): number {
  if (rack.mode === 'nine-ball') return rack.balls.length;
  const group = rack.groups[seat];
  if (group === null) return rack.balls.filter((ball) => ball !== 8).length;
  return rack.balls.filter((ball) => groupOf(ball) === group).length;
}

const HEAD_STRING_ALONG = 25;

export function placementAllowed(rack: Rack, along: number): boolean {
  return !rack.behindHeadString || along <= HEAD_STRING_ALONG;
}

export function groupWord(group: Group | null): string {
  if (group === null) return 'Open';
  return group === 'solids' ? 'Solids' : 'Stripes';
}

export function legalFirstBall(rack: Rack, seat: Seat, ball: number): boolean {
  if (rack.mode === 'nine-ball') return ball === Math.min(...rack.balls);
  const group = rack.groups[seat];
  if (group === null) return ball !== 8;
  return groupCleared(rack, seat) ? ball === 8 : groupOf(ball) === group;
}

function firstFoul(rack: Rack, shot: ShotOutcome): string | null {
  if (shot.scratch) return FOUL_SCRATCH;
  if (shot.offTable.length > 0) return FOUL_OFF_TABLE;
  if (shot.firstContact === null) return FOUL_NO_CONTACT;
  if (!legalFirstBall(rack, rack.activeSeat, shot.firstContact)) {
    return rack.mode === 'nine-ball' ? FOUL_WRONG_LOWEST : FOUL_WRONG_GROUP;
  }
  if (rack.phase !== 'break' && shot.pocketed.length === 0 && !shot.cushion) return FOUL_NO_CUSHION;
  return null;
}

function eightBallLoss(rack: Rack, shot: ShotOutcome, foul: string | null, calledPocket: Pocket | null): WinReason | null {
  const eight = shot.pocketed.find((potted) => potted.ball === 8);
  if (eight === undefined) return null;
  if (shot.scratch) return 'scratch';
  if (foul !== null) return 'foul';
  if (!groupCleared(rack, rack.activeSeat)) return 'early';
  return eight.pocket === calledPocket ? null : 'uncalled';
}

function eightBallOutcome(rack: Rack, shot: ShotOutcome, foul: string | null, calledPocket: Pocket | null): Win | null {
  const shooter = rack.activeSeat;
  if (!shot.pocketed.some((potted) => potted.ball === 8)) return null;
  const loss = eightBallLoss(rack, shot, foul, calledPocket);
  return loss === null ? { seat: shooter, reason: 'called' } : { seat: otherSeat(shooter), reason: loss };
}

export function adjudicate(rack: Rack, shot: ShotOutcome, calledPocket: Pocket | null, names: SeatNames): Ruling {
  const shooter = rack.activeSeat;
  const opponent = otherSeat(shooter);
  const nine = rack.mode === 'nine-ball';
  const breaking = !nine && rack.phase === 'break';
  const foul = firstFoul(rack, shot);
  const illegalBreak = breaking && (foul !== null || (shot.pocketed.length === 0 && !shot.cushion));
  const fouled = foul !== null || illegalBreak;
  const eightPotted = !nine && shot.pocketed.some((potted) => potted.ball === 8);
  const ninePotted = nine && shot.pocketed.some((potted) => potted.ball === 9);

  const ruling: Ruling = {
    next: { ...rack, ballInHand: false, behindHeadString: false },
    potLines: shot.pocketed.map(({ ball, pocket }) => `Ball ${ball} potted in ${pocketName(pocket)}.`),
    legalLine: !fouled && shot.pocketed.length === 0 ? LEGAL_NOTHING : null,
    claim: null,
    foul: breaking ? null : foul,
    illegalBreak: illegalBreak ? ILLEGAL_BREAK : null,
    eightOnBreak: breaking && eightPotted && !illegalBreak ? EIGHT_ON_BREAK : null,
    ballInHandHolder: null,
    win: null,
  };

  if (nine && ninePotted && !fouled) {
    ruling.win = { seat: shooter, reason: 'nine' };
  } else if (!nine && !breaking) {
    ruling.win = eightBallOutcome(rack, shot, foul, calledPocket);
  }
  if (ruling.win !== null) {
    ruling.next.balls = rack.balls.filter((ball) => !shot.pocketed.some((potted) => potted.ball === ball));
    return ruling;
  }

  const stays = (ball: number): boolean => {
    if (breaking && ball === 8) return true;
    if (nine && ball === 9) return true;
    return !shot.pocketed.some((potted) => potted.ball === ball);
  };
  ruling.next.balls = rack.balls.filter(stays);
  if (rack.phase === 'break' && !nine) ruling.next.phase = 'open';

  if (fouled) {
    ruling.next.activeSeat = opponent;
    ruling.next.ballInHand = true;
    ruling.next.behindHeadString = illegalBreak;
    ruling.ballInHandHolder = opponent;
    return ruling;
  }

  if (!nine && rack.phase === 'open' && shot.pocketed.length > 0) {
    const claimed = groupOf(shot.pocketed[0].ball);
    if (claimed !== null) {
      ruling.next.phase = 'groups';
      ruling.next.groups = { [shooter]: claimed, [opponent]: claimed === 'solids' ? 'stripes' : 'solids' } as Record<Seat, Group>;
      ruling.claim = `${names[shooter]} takes ${claimed}.`;
    }
  }

  const ownGroup = ruling.next.groups[shooter];
  const keepsTurn = nine || breaking
    ? shot.pocketed.length > 0
    : shot.pocketed.some((potted) => groupOf(potted.ball) === ownGroup);
  ruling.next.activeSeat = keepsTurn ? shooter : opponent;
  return ruling;
}

export function adjudicateClockExpiry(rack: Rack): Ruling {
  const opponent = otherSeat(rack.activeSeat);
  const breaking = rack.mode !== 'nine-ball' && rack.phase === 'break';
  return {
    next: {
      ...rack,
      activeSeat: opponent,
      ballInHand: true,
      behindHeadString: breaking,
      phase: breaking ? 'open' : rack.phase,
    },
    potLines: [],
    legalLine: null,
    claim: null,
    foul: breaking ? null : FOUL_CLOCK,
    illegalBreak: breaking ? ILLEGAL_BREAK : null,
    eightOnBreak: null,
    ballInHandHolder: opponent,
    win: null,
  };
}

export function resultLine(win: Win, viewer: Seat, names: SeatNames): string {
  const other = names[otherSeat(viewer)];
  const winning = win.seat === viewer;
  const lines: Record<WinReason, [string, string]> = {
    called: ['You won: 8 in the called pocket.', `You lost: ${other} potted the 8 in the called pocket.`],
    early: [`You won: ${other} potted the 8 early.`, 'You lost: 8 potted before your group was cleared.'],
    uncalled: [`You won: ${other} potted the 8 in an uncalled pocket.`, 'You lost: 8 potted in an uncalled pocket.'],
    scratch: [`You won: ${other} scratched on the 8.`, 'You lost: scratched on the 8.'],
    foul: [`You won: ${other} fouled on the 8.`, 'You lost: foul on the 8.'],
    forfeit: [`You won: ${other} forfeited.`, 'You lost: forfeited after 3 timed-out turns.'],
    nine: ['You won: 9 potted legally.', `You lost: ${other} potted the 9.`],
  };
  return lines[win.reason][winning ? 0 : 1];
}

/** The one sentence the banner rule picks for a shot; a finished match shows each viewer's own result line instead. */
export function bannerSentence(ruling: Ruling): string {
  return (
    ruling.foul ??
    ruling.illegalBreak ??
    ruling.eightOnBreak ??
    (calledPocketRequired(ruling.next) ? CALL_POCKET : null) ??
    ruling.claim ??
    ruling.potLines.at(-1) ??
    ruling.legalLine ??
    ''
  );
}

export function turnText(rack: Rack, viewer: Seat | null, names: SeatNames, over: boolean): string {
  if (over) return 'Game over';
  if (rack.activeSeat !== viewer) return `${names[rack.activeSeat]}'s turn`;
  return rack.ballInHand ? 'Ball in hand' : 'Your turn';
}

/** The log for one shot in the published order, up to the Turn line; the caller appends the viewer's Turn and result lines. */
export function shotLines(ruling: Ruling, names: SeatNames): string[] {
  const lines = [...ruling.potLines];
  if (ruling.legalLine !== null) lines.push(ruling.legalLine);
  if (ruling.claim !== null) lines.push(ruling.claim);
  const decided = ruling.foul ?? ruling.illegalBreak ?? ruling.eightOnBreak;
  if (decided !== null) lines.push(decided);
  if (ruling.win === null) {
    if (ruling.ballInHandHolder !== null) lines.push(`${names[ruling.ballInHandHolder]} has ball in hand.`);
    if (calledPocketRequired(ruling.next)) lines.push(CALL_POCKET);
  }
  return lines;
}
