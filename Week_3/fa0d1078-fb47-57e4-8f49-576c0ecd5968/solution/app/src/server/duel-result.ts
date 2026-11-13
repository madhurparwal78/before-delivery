import { wholeSeconds } from "../shared/score";

/** What the server knows of one seat: when its board was first seen solved (ms from the start), and whether it is out or gone. */
interface SeatStatus {
  solvedAt: number | null;
  out: boolean;
  forfeited: boolean;
}

export type SeatNumber = 1 | 2;

export type DuelDecision =
  | { kind: "finish"; winner: SeatNumber; seconds: number }
  | { kind: "tie" }
  | { kind: "out"; winner: SeatNumber }
  | { kind: "forfeit"; winner: SeatNumber }
  | { kind: "abandoned" };

export const otherSeat = (seat: SeatNumber): SeatNumber => (seat === 1 ? 2 : 1);

/**
 * The one place a duel is decided. `elapsed` is the ms since the start. Out and forfeit decide at once; a
 * solved board waits `tieMs` for the other board: solved within the window is a tie, otherwise the first
 * finisher wins.
 */
export function decideDuel(seats: Record<SeatNumber, SeatStatus>, elapsed: number, tieMs: number): DuelDecision | null {
  if (seats[1].forfeited && seats[2].forfeited) return { kind: "abandoned" };
  for (const seat of [1, 2] as const) {
    if (seats[seat].forfeited) return { kind: "forfeit", winner: otherSeat(seat) };
  }
  const solved = ([1, 2] as const).flatMap((seat) => {
    const at = seats[seat].solvedAt;
    return at === null ? [] : [{ seat, at }];
  });
  const first = solved.sort((a, b) => a.at - b.at)[0];
  if (first === undefined) {
    for (const seat of [1, 2] as const) {
      if (seats[seat].out) return { kind: "out", winner: otherSeat(seat) };
    }
    return null;
  }
  if (elapsed - first.at < tieMs) return null;
  const second = seats[otherSeat(first.seat)].solvedAt;
  return second !== null && second - first.at <= tieMs ? { kind: "tie" } : { kind: "finish", winner: first.seat, seconds: wholeSeconds(first.at) };
}
