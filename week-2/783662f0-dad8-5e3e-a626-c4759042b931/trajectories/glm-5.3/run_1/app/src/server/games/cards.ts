/** The four-player trick-taking card game, decided only here.
 * Dealt from a stored seed, follow suit, highest of the led suit wins, 13 tricks make a hand. */

export const Ranks = "23456789TJQKA";
export const Suits = "CDHS";

export const RankWords: Record<string, string> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  T: "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
};

export const SuitWords: Record<string, string> = { C: "Clubs", D: "Diamonds", H: "Hearts", S: "Spades" };

export function cardName(code: string): string {
  const rank = code[0];
  const suit = code[1];
  return `${RankWords[rank ?? ""] ?? "?"} of ${SuitWords[suit ?? ""] ?? "?"}`;
}

export function fullDeck(): string[] {
  const deck: string[] = [];
  for (const suit of Suits) {
    for (const rank of Ranks) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

/** Deterministic shuffle from a seed string: Fisher-Yates driven by a 32-bit PRNG. */
export function shuffledDeck(seed: string): string[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const deck = fullDeck().slice();
  for (let i = deck.length - 1; i > 0; i--) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const j = Math.abs(h) % (i + 1);
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

export function dealHands(seed: string): string[][] {
  const deck = shuffledDeck(seed);
  const hands: string[][] = [[], [], [], []];
  for (let i = 0; i < 52; i++) {
    hands[i % 4]!.push(deck[i]!);
  }
  return hands;
}

export interface CardPosition {
  trick: { seat: number; card: string }[];
  led_suit: string | null;
  tricks_won: number[];
  first_seat?: number;
}

export function startPosition(firstSeat: number): CardPosition {
  return { trick: [], led_suit: null, tricks_won: [0, 0, 0, 0], first_seat: firstSeat };
}

export interface CardCheck {
  ok: boolean;
  error: "not_in_hand" | "must_follow_suit" | null;
}

/** Legality of playing card from seat's hand. toMoveSeat is the seat on turn. */
export function checkPlay(hand: string[], position: CardPosition, toMoveSeat: number, seat: number, card: string): CardCheck {
  if (seat !== toMoveSeat) return { ok: false, error: null }; // handled by the caller as not_your_turn
  if (!hand.includes(card)) return { ok: false, error: "not_in_hand" };
  const led = position.led_suit;
  if (led !== null) {
    const hasLed = hand.some((c) => c[1] === led);
    if (hasLed && card[1] !== led) return { ok: false, error: "must_follow_suit" };
  }
  return { ok: true, error: null };
}

export interface CardApplyResult {
  position: CardPosition;
  trickWinner: number | null;
  handOver: boolean;
}

/** Applies a legal play. Returns the new position and, when the trick completes, its winner. */
export function applyPlay(position: CardPosition, seat: number, card: string): CardApplyResult {
  const trick = [...position.trick, { seat, card }];
  const ledSuit = position.led_suit ?? card[1]!;
  if (trick.length < 4) {
    return {
      position: { trick, led_suit: ledSuit, tricks_won: position.tricks_won },
      trickWinner: null,
      handOver: false,
    };
  }
  // Trick complete: highest card of the led suit wins, Ace high.
  let bestSeat = trick[0]!.seat;
  let bestCard = trick[0]!.card;
  for (const entry of trick.slice(1)) {
    if (entry.card[1] === ledSuit && Ranks.indexOf(entry.card[0]!) > Ranks.indexOf(bestCard[0]!)) {
      bestSeat = entry.seat;
      bestCard = entry.card;
    }
  }
  const tricksWon = position.tricks_won.slice();
  tricksWon[bestSeat - 1] = tricksWon[bestSeat - 1]! + 1;
  const handOver = tricksWon.reduce((a, b) => a + b, 0) === 13;
  return {
    position: { trick: [], led_suit: null, tricks_won: tricksWon },
    trickWinner: bestSeat,
    handOver,
  };
}

/** Seat on turn: within a trick, the next seat up from the leader; between tricks, the last winner. */
export function nextSeat(position: CardPosition, leader: number): number {
  if (position.trick.length === 0) return leader;
  const last = position.trick[position.trick.length - 1]!;
  const next = (last.seat % 4) + 1;
  return next;
}

/** The seat that wins each trick, in order, replayed from a stored deal and played cards. */
export function replayHand(seed: string, firstSeat: number, plays: string[]): { tricks_won: number[]; ok: boolean } {
  const hands = dealHands(seed).map((h) => h.slice());
  let position: CardPosition = { trick: [], led_suit: null, tricks_won: [0, 0, 0, 0] };
  let leader = firstSeat;
  for (const card of plays) {
    const seat = nextSeat(position, leader);
    const hand = hands[seat - 1]!;
    const check = checkPlay(hand, position, seat, seat, card);
    if (!check.ok) return { tricks_won: position.tricks_won, ok: false };
    hands[seat - 1] = hand.filter((c) => c !== card);
    const result = applyPlay(position, seat, card);
    if (result.trickWinner !== null) leader = result.trickWinner;
    position = result.position;
  }
  return { tricks_won: position.tricks_won, ok: true };
}

export function handCounts(hands: string[][]): number[] {
  return hands.map((h) => h.length);
}
