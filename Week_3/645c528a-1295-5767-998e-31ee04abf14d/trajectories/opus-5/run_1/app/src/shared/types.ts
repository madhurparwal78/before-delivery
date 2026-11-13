export type Mode = 'eight-ball' | 'nine-ball' | 'no-guidelines';
export type Group = 'solids' | 'stripes' | null;
export type Seat = 1 | 2;
export type Phase = 'break' | 'open' | 'groups';

export type Pocket =
  | 'top-left'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-right';

export const POCKETS: Pocket[] = [
  'top-left',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-right',
];

export const POCKET_LABELS: Record<Pocket, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'middle-left': 'Middle left',
  'middle-right': 'Middle right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

export type FoulKind = 'scratch' | 'off-table' | 'no-contact' | 'wrong-first' | 'no-cushion' | 'clock';

export type ResultCase =
  | 'called'
  | 'early'
  | 'uncalled'
  | 'scratch-on-8'
  | 'foul-on-8'
  | 'forfeit'
  | 'nine'
  | 'void';

export interface Point {
  across: number;
  along: number;
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

export interface ShotInput {
  aimDegrees: number;
  power: number;
  sideSpin: number;
  topSpin: number;
  calledPocket: Pocket | null;
}

export interface MatchState {
  mode: Mode;
  phase: Phase;
  groups: { 1: Group; 2: Group };
  balls: number[];
  activeSeat: Seat;
  ballInHand: boolean;
  behindHeadString: boolean;
  calledPocketRequired: boolean;
  positions: Record<number, Point>;
  over: boolean;
}

/** An announcement that each viewer resolves into their own words. */
export type Announcement =
  | { type: 'plain'; text: string }
  | { type: 'turn'; seat: Seat; ballInHand: boolean }
  | { type: 'game-over' }
  | { type: 'result'; winnerSeat: Seat | null; resultCase: ResultCase };

export interface Ruling {
  announcements: Announcement[];
  banner: Announcement | null;
  foul: FoulKind | null;
  illegalBreak: boolean;
  eightOnBreak: boolean;
  winnerSeat: Seat | null;
  resultCase: ResultCase | null;
  state: MatchState;
}
