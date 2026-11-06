import type { GameKind } from '../../shared/domain.js';
import type { ResultObject } from '../../shared/types.js';

/** The settlement split, in one place. */

export type Reason = ResultObject['reason'];
export type Outcome = ResultObject['outcome'];

export interface SeatFacts {
  readonly seat: number;
  readonly characterId: string;
  readonly name: string;
}

export interface Ending {
  readonly game: GameKind;
  readonly outcome: Outcome;
  readonly reason: Reason;
  readonly stake: number;
  readonly seats: readonly SeatFacts[];
  /** Winning seats, in seat order. */
  readonly winners: readonly number[];
  /** The seat that forfeited or ran out of time, when that is the reason. */
  readonly loserSeat?: number | null;
  /** Tricks won per seat index, for a card hand that played out. */
  readonly tricksWon?: readonly number[];
}

/** Each seat's payout from the escrow, keyed by seat number. */
export function payouts(ending: Ending): Map<number, number> {
  const { stake, seats } = ending;
  const out = new Map<number, number>();
  for (const seat of seats) out.set(seat.seat, 0);

  if (ending.outcome === 'draw' || ending.outcome === 'abandoned') {
    for (const seat of seats) out.set(seat.seat, stake);
    return out;
  }

  if (seats.length === 2) {
    for (const seat of seats) {
      out.set(seat.seat, ending.winners.includes(seat.seat) ? stake * 2 : 0);
    }
    return out;
  }

  // The card game: the top seats share the stakes of the others.
  const topSeats = [...ending.winners].sort((a, b) => a - b);
  const otherCount = seats.length - topSeats.length;
  const pot = stake * otherCount;
  const share = topSeats.length === 0 ? 0 : Math.floor(pot / topSeats.length);
  let remainder = topSeats.length === 0 ? 0 : pot - share * topSeats.length;
  for (const seat of topSeats) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    out.set(seat, stake + share + extra);
  }
  return out;
}

/** Result `settlement` amounts are payout minus stake. */
function settlementLines(
  ending: Ending,
): { character_id: string; amount: number }[] {
  const paid = payouts(ending);
  return [...ending.seats]
    .sort((a, b) => a.seat - b.seat)
    .map((seat) => ({
      character_id: seat.characterId,
      amount: (paid.get(seat.seat) ?? 0) - ending.stake,
    }));
}

/** The winners of a card hand: every seat on the top trick count. */
export function cardWinners(tricksWon: readonly number[]): number[] {
  const top = Math.max(...tricksWon);
  const winners: number[] = [];
  tricksWon.forEach((count, index) => {
    if (count === top) winners.push(index + 1);
  });
  return winners;
}

const reasonSentence = (ending: Ending): string => {
  const named = (seat: number | null | undefined): string =>
    ending.seats.find((entry) => entry.seat === seat)?.name ?? '';
  switch (ending.reason) {
    case 'checkmate':
      return 'Checkmate.';
    case 'stalemate':
      return 'Stalemate.';
    case 'threefold_repetition':
      return 'Threefold repetition.';
    case 'fifty_move_rule':
      return 'Fifty-move rule.';
    case 'four_in_a_row':
      return 'Four in a row.';
    case 'board_full':
      return 'Board full.';
    case 'hand_over':
      return 'Hand over.';
    case 'timeout':
      return `${named(ending.loserSeat)} ran out of time.`;
    case 'forfeit':
      return `${named(ending.loserSeat)} forfeited.`;
    case 'server_suspended':
      return 'Abandoned: the server was suspended.';
  }
};

const resultSentence = (ending: Ending): string => {
  if (ending.outcome === 'abandoned') return 'Stakes returned.';
  if (ending.outcome === 'draw') return 'Draw.';
  const names = [...ending.winners]
    .sort((a, b) => a - b)
    .map((seat) => ending.seats.find((entry) => entry.seat === seat)?.name ?? '');
  if (names.length === 0) return 'Draw.';
  if (names.length === 1) return `${names[0]} wins.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} win.`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} win.`;
};

/** `<reason sentence> <result sentence>` */
export const endCopy = (ending: Ending): string =>
  `${reasonSentence(ending)} ${resultSentence(ending)}`;

export function resultObject(ending: Ending): ResultObject {
  return {
    outcome: ending.outcome,
    reason: ending.reason,
    winners: [...ending.winners].sort((a, b) => a - b),
    text: endCopy(ending),
    settlement: settlementLines(ending),
  };
}
