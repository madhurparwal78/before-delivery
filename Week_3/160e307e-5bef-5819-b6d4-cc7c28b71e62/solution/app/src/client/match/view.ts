import { coinsOnBoard, colourOf } from "../../shared/rules";
import type { BoardEnd, Colour, EndReason, FrameSample, Format, MatchState, PieceState, QueenState, Seat, ShotEvents, ShotOutcome, Verdict } from "../../shared/types";

/** What the match screen needs to know, whether the match is online or on this device. */

export type Mode = "local" | "private" | "casual" | "ranked";

export interface SeatView {
  seat: Seat;
  playerId?: string | null;
  name: string;
  avatar: number | null;
  color: Colour;
  score: number;
  coinsLeft: number;
  dues: number;
  strikerSkin: string;
  connected: boolean;
}

export interface SeatSettlement {
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  chalk: number;
}

export interface RematchView {
  status: "offered" | "accepted" | "declined" | "expired";
  offeredBy: Seat;
  matchId: string | null;
  remainingMs: number | null;
}

export interface MatchView {
  id: string;
  mode: Mode;
  format: Format;
  status: "waiting" | "active" | "completed" | "forfeit" | "abandoned";
  board: number;
  turn: Seat;
  shotSeq: number;
  breakAttempt: 1 | 2 | 3 | null;
  seats: [SeatView, SeatView];
  queen: QueenState;
  pieces: PieceState[];
  finished: boolean;
  winnerSeat: Seat | null;
  endReason: EndReason | null;
  roomCode: string | null;
  toss: string | null;
  turnRemainingMs: number | null;
  settlement: { seats: [SeatSettlement, SeatSettlement] } | null;
  rematch: RematchView | null;
}

export interface RulingView {
  shotSeq: number;
  seat: Seat;
  events: ShotEvents;
  verdict: Verdict;
  frames: FrameSample[];
  final: PieceState[];
  boardEnd: BoardEnd | null;
  match: MatchView;
}

interface WireSeat {
  seat: Seat;
  playerId: string | null;
  name: string | null;
  avatar: number | null;
  color: Colour;
  score: number;
  coinsLeft: number;
  dues: number;
  strikerSkin: string;
  connected: boolean;
}

export interface WireMatch {
  id: string;
  mode: Mode;
  format: Format;
  status: MatchView["status"];
  board: number;
  turn: Seat;
  shotSeq: number;
  breakAttempt: 1 | 2 | 3 | null;
  seats: [WireSeat, WireSeat];
  queen: QueenState;
  pieces: PieceState[];
  winnerSeat: Seat | null;
  endReason: EndReason | null;
  roomCode: string | null;
  toss: string | null;
  turnRemainingMs: number | null;
  settlement: MatchView["settlement"];
  rematch: RematchView | null;
}

export function fromWire(wire: WireMatch): MatchView {
  const seat = (s: WireSeat): SeatView => ({ ...s, name: s.name ?? "Opponent" });
  return {
    ...wire,
    seats: [seat(wire.seats[0]), seat(wire.seats[1])],
    finished: wire.status === "completed" || wire.status === "forfeit" || wire.status === "abandoned",
  };
}

/** The view of a pass-and-play match held in this browser. */
export function fromLocal(state: MatchState, names: readonly [string, string], shotSeq: number, strikerSkin: string): MatchView {
  const seat = (s: Seat): SeatView => ({
    seat: s,
    name: names[s],
    avatar: null,
    color: colourOf(state, s),
    score: state.scores[s],
    coinsLeft: coinsOnBoard(state.pieces, state.white, s).length,
    dues: state.dues[s],
    strikerSkin,
    connected: true,
  });
  return {
    id: "local",
    mode: "local",
    format: state.format,
    status: state.finished ? (state.endReason === "played" ? "completed" : "forfeit") : "active",
    board: state.board,
    turn: state.turn,
    shotSeq,
    breakAttempt: state.breakAttempt,
    seats: [seat(0), seat(1)],
    queen: state.queen,
    pieces: state.pieces,
    finished: state.finished,
    winnerSeat: state.winnerSeat,
    endReason: state.endReason,
    roomCode: null,
    toss: null,
    turnRemainingMs: null,
    settlement: null,
    rematch: null,
  };
}

export function rulingFromOutcome(outcome: ShotOutcome, view: MatchView, seat: Seat): RulingView {
  return { shotSeq: view.shotSeq, seat, events: outcome.events, verdict: outcome.verdict, frames: outcome.frames, final: outcome.final, boardEnd: outcome.boardEnd, match: view };
}
