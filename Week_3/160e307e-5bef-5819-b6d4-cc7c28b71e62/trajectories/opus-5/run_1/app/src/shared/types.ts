export type Seat = 0 | 1;
export type Colour = 'white' | 'black';
export type PocketId = 'nw' | 'ne' | 'sw' | 'se';
export type PieceId = string;
export type Format = 'quick' | 'classic';
export type Mode = 'local' | 'private' | 'casual' | 'ranked';
export type QueenState = 'board' | 'pending' | 'covered';
export type MatchStatus = 'waiting' | 'active' | 'completed' | 'forfeit' | 'abandoned';
export type EndReason = 'played' | 'left' | 'timeouts' | 'resigned';
export type Tier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

export interface Piece {
  id: PieceId;
  x: number | null;
  y: number | null;
  state: 'board' | 'pocketed';
  pocketedBy: Seat | null;
}

export interface Body {
  id: PieceId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  pocketed: PocketId | null;
}

export interface Frame {
  t: number;
  pieces: { id: PieceId; x: number; y: number }[];
}

export interface ShotEvents {
  firstContact: PieceId | 'cushion' | null;
  pocketed: { id: PieceId; pocket: PocketId }[];
  strikerPocketed: boolean;
}

export interface SimulationResult {
  events: ShotEvents;
  frames: Frame[];
  final: { id: PieceId; x: number | null; y: number | null; state: 'board' | 'pocketed' }[];
  durationSeconds: number;
  maxSpeedAtRest: number;
}

export interface Intent {
  seat: Seat;
  x: number;
  dx: number;
  dy: number;
  p: number;
}

export interface Verdict {
  word: string;
  line: string;
}

/** The part of a match the laws of carrom read and write. */
export interface BoardState {
  board: number;
  turn: Seat;
  whiteSeat: Seat;
  breakAttempt: number | null;
  pieces: Piece[];
  queen: { state: QueenState; seat: Seat | null };
  dues: [number, number];
  scores: [number, number];
}

export interface BoardOutcome {
  winnerSeat: Seat;
  points: number;
  pointsLine: string;
}

export interface Ruling {
  verdict: Verdict;
  turnPasses: boolean;
  breakRetry: boolean;
  boardOutcome: BoardOutcome | null;
}
