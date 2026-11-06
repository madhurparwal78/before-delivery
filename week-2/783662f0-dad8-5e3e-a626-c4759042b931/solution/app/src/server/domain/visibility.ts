/**
 * The card visibility filter, in one place. Until the hand ends, a card in a
 * hand that has not been played reaches only its holder.
 */

interface Viewer {
  /** The seat this viewer holds at the table, or null for anyone else. */
  readonly seat: number | null;
}

interface CardFacts {
  /** Hands as dealt, by seat index. */
  readonly dealt: readonly (readonly string[])[] | null;
  /** Hands as they stand now, by seat index. */
  readonly remaining: readonly (readonly string[])[] | null;
  readonly seed: number | null;
  readonly handOver: boolean;
}

interface FilteredCards {
  /** The viewer's own remaining hand, or null. */
  readonly hand: string[] | null;
  /** Dealt hands, shown to everyone only once the hand has ended. */
  readonly hands: string[][] | null;
  readonly seed: number | null;
  readonly handCounts: number[];
}

export function filterCards(facts: CardFacts, viewer: Viewer): FilteredCards {
  const remaining = facts.remaining ?? [];
  const handCounts = remaining.map((hand) => hand.length);

  if (facts.handOver) {
    return {
      hand: viewer.seat === null ? null : [...(remaining[viewer.seat - 1] ?? [])],
      hands: facts.dealt === null ? null : facts.dealt.map((hand) => [...hand]),
      seed: facts.seed,
      handCounts,
    };
  }

  return {
    hand:
      viewer.seat === null ? null : [...(remaining[viewer.seat - 1] ?? [])],
    hands: null,
    seed: null,
    handCounts,
  };
}

/**
 * `GET /api/games/<id>` gives a seated player their own hands entry and a null
 * seed; everyone else gets null for both until the hand ends.
 */
export function filterRecordHands(facts: CardFacts, viewer: Viewer): {
  hands: string[][] | null;
  seed: number | null;
} {
  if (facts.handOver) {
    return {
      hands: facts.dealt === null ? null : facts.dealt.map((hand) => [...hand]),
      seed: facts.seed,
    };
  }
  const seat = viewer.seat;
  if (seat === null || facts.dealt === null) return { hands: null, seed: null };
  if (facts.dealt[seat - 1] === undefined) return { hands: null, seed: null };
  const hands = facts.dealt.map((hand, index) => (index === seat - 1 ? [...hand] : []));
  return { hands, seed: null };
}
