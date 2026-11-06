import { RANKS, SUITS, type Suit } from '../../shared/domain.js';
import { shuffle } from '../util.js';

/**
 * The four-player trick-taking game, in one place. 52 cards dealt 13 each from
 * a stored seed, following suit is enforced, the highest card of the led suit
 * takes the trick and each trick scores one point.
 */

const SEATS = 4;

const fullDeck = (): string[] =>
  SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`));

/** Hands by seat index, dealt from the stored seed. */
export function deal(seed: number): string[][] {
  const deck = shuffle(fullDeck(), seed);
  const hands: string[][] = [[], [], [], []];
  deck.forEach((card, index) => {
    hands[index % SEATS].push(card);
  });
  return hands.map((hand) => sortHand(hand));
}

const rankValue = (card: string): number => RANKS.indexOf(card[0] as (typeof RANKS)[number]);
const suitOf = (card: string): Suit => card[1] as Suit;

const sortHand = (hand: readonly string[]): string[] =>
  [...hand].sort((a, b) => {
    const suits = SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b));
    return suits !== 0 ? suits : rankValue(a) - rankValue(b);
  });

export interface TrickPlay {
  readonly seat: number;
  readonly card: string;
}

export interface TricksState {
  /** Hands by seat index, as they stand now. */
  readonly hands: readonly (readonly string[])[];
  readonly trick: readonly TrickPlay[];
  readonly ledSuit: Suit | null;
  readonly tricksWon: readonly number[];
  /** The seat that leads the current trick. */
  readonly leader: number;
}

export const openingState = (hands: readonly (readonly string[])[], leader: number): TricksState => ({
  hands: hands.map((hand) => [...hand]),
  trick: [],
  ledSuit: null,
  tricksWon: [0, 0, 0, 0],
  leader,
});

type TricksRefusal = 'must_follow_suit' | 'not_in_hand';

interface TrickOutcome {
  readonly state: TricksState;
  /** Set when this card completed the trick. */
  readonly trickWinner: number | null;
  readonly handOver: boolean;
}

type TricksApply =
  | { readonly ok: true; readonly outcome: TrickOutcome }
  | { readonly ok: false; readonly refusal: TricksRefusal };

/** The highest card of the led suit wins, Ace high and no trumps. */
function trickWinner(trick: readonly TrickPlay[], ledSuit: Suit): number {
  let best = trick[0];
  for (const play of trick) {
    if (suitOf(play.card) !== ledSuit) continue;
    if (suitOf(best.card) !== ledSuit || rankValue(play.card) > rankValue(best.card)) best = play;
  }
  return best.seat;
}

/** Seats are numbered from 1, while the hands are held in a 0-based array. */
export function applyPlay(state: TricksState, seat: number, card: string): TricksApply {
  const hand = state.hands[seat - 1] ?? [];
  if (!hand.includes(card)) return { ok: false, refusal: 'not_in_hand' };
  if (state.ledSuit !== null && suitOf(card) !== state.ledSuit) {
    const canFollow = hand.some((held) => suitOf(held) === state.ledSuit);
    if (canFollow) return { ok: false, refusal: 'must_follow_suit' };
  }

  const hands = state.hands.map((seatHand, index) =>
    index === seat - 1 ? seatHand.filter((held) => held !== card) : [...seatHand],
  );
  const trick = [...state.trick, { seat, card }];
  const ledSuit = state.ledSuit ?? suitOf(card);

  if (trick.length < SEATS) {
    return {
      ok: true,
      outcome: {
        state: { ...state, hands, trick, ledSuit },
        trickWinner: null,
        handOver: false,
      },
    };
  }

  const winner = trickWinner(trick, ledSuit);
  const tricksWon = state.tricksWon.map((count, index) =>
    index === winner - 1 ? count + 1 : count,
  );
  const handOver = hands.every((seatHand) => seatHand.length === 0);
  return {
    ok: true,
    outcome: {
      state: { hands, trick: [], ledSuit: null, tricksWon, leader: winner },
      trickWinner: winner,
      handOver,
    },
  };
}

/** Play goes up the seats, wrapping from 4 to 1. */
const nextSeat = (seat: number): number => (seat % SEATS) + 1;

export const seatToMove = (state: TricksState): number =>
  state.trick.length === 0
    ? state.leader
    : nextSeat(state.trick[state.trick.length - 1].seat);

export function legalPlays(state: TricksState, seat: number): string[] {
  const hand = state.hands[seat - 1] ?? [];
  if (state.ledSuit === null) return [...hand];
  const following = hand.filter((card) => suitOf(card) === state.ledSuit);
  return following.length > 0 ? following : [...hand];
}
