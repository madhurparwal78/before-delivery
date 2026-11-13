export type Seat = 0 | 1;
export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type CoinId = `${"w" | "b"}${Digit}`;
export type PieceId = "striker" | "queen" | CoinId;
export type PocketId = "nw" | "ne" | "sw" | "se";
export type Format = "quick" | "classic";
export type Colour = "white" | "black";
export type QueenStatus = "board" | "pending" | "covered";
export type EndReason = "played" | "left" | "timeouts" | "resigned";

export interface PieceState {
  id: PieceId;
  x: number | null;
  y: number | null;
  state: "board" | "pocketed";
  pocketedBy: Seat | null;
}

export interface QueenState {
  state: QueenStatus;
  seat: Seat | null;
}

export interface ShotIntent {
  /** striker offset from the baseline centre in mm, left to right as the shooter sees it */
  x: number;
  dx: number;
  dy: number;
  /** power, 0 to 1 */
  p: number;
}

export interface ShotEvents {
  firstContact: PieceId | "cushion" | null;
  pocketed: { id: PieceId; pocket: PocketId }[];
  strikerPocketed: boolean;
}

export interface Verdict {
  word: string;
  line: string;
}

export interface FrameSample {
  t: number;
  pieces: { id: PieceId; x: number | null; y: number | null }[];
}

/** Everything the laws of carrom need to know about a match, serialisable as JSON. */
export interface MatchState {
  format: Format;
  board: number;
  scores: [number, number];
  /** the seat that plays white on this board and breaks it */
  white: Seat;
  turn: Seat;
  breakAttempt: 1 | 2 | 3 | null;
  dues: [number, number];
  timeouts: [number, number];
  pieces: PieceState[];
  queen: QueenState;
  finished: boolean;
  winnerSeat: Seat | null;
  endReason: EndReason | null;
}

export interface BoardEnd {
  board: number;
  winnerSeat: Seat;
  points: number;
  line: string;
}

export interface ShotOutcome {
  events: ShotEvents;
  verdict: Verdict;
  frames: FrameSample[];
  final: PieceState[];
  boardEnd: BoardEnd | null;
  next: MatchState;
}
