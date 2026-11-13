import type { FeedRow, MatchRow } from './matches';

const BRACKET_ORDER: Record<string, number> = { winners: 1, losers: 2, final: 3, main: 4 };

const slotFilled = (match: MatchRow, slot: 'upper' | 'lower'): boolean =>
  slot === 'upper'
    ? match.upper_entrant_id !== null || match.upper_bye
    : match.lower_entrant_id !== null || match.lower_bye;

const grandFinalReset = (matches: MatchRow[]): MatchRow | undefined =>
  matches.find((match) => match.bracket === 'final' && match.round === 2);

/**
 * The dependent set of a proposed result change: every later match whose slot fed from the edited
 * match, or from a match already in the set, currently holds an entrant or a bye. In reset order.
 */
export const dependentSet = (matches: MatchRow[], feeds: FeedRow[], editedId: string): MatchRow[] => {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const outgoing = new Map<string, FeedRow[]>();
  for (const feed of feeds) {
    const list = outgoing.get(feed.src_match_id) ?? [];
    list.push(feed);
    outgoing.set(feed.src_match_id, list);
  }

  const distance = new Map<string, number>();
  const queue: { id: string; depth: number }[] = [{ id: editedId, depth: 0 }];

  const join = (match: MatchRow, depth: number): void => {
    const known = distance.get(match.id);
    if (known !== undefined && known >= depth) return;
    distance.set(match.id, depth);
    queue.push({ id: match.id, depth });
  };

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; depth: number };
    const source = byId.get(current.id);
    if (source === undefined) continue;
    for (const feed of outgoing.get(current.id) ?? []) {
      const destination = byId.get(feed.dst_match_id);
      if (destination === undefined) continue;
      if (!slotFilled(destination, feed.slot)) continue;
      join(destination, current.depth + 1);
    }
    if (source.bracket === 'final' && source.round === 1) {
      const reset = grandFinalReset(matches);
      if (
        reset !== undefined &&
        (reset.state === 'not_needed' || reset.upper_entrant_id !== null || reset.lower_entrant_id !== null)
      ) {
        join(reset, current.depth + 1);
      }
    }
  }

  distance.delete(editedId);
  return [...distance.keys()]
    .map((id) => byId.get(id) as MatchRow)
    .sort(
      (a, b) =>
        (distance.get(a.id) as number) - (distance.get(b.id) as number) ||
        (BRACKET_ORDER[a.bracket] ?? 9) - (BRACKET_ORDER[b.bracket] ?? 9) ||
        a.round - b.round ||
        a.number - b.number,
    );
};

/** Slots of a set member that were fed from the edited match or from another set member. */
export const slotsFedBySet = (
  feeds: FeedRow[],
  setIds: Set<string>,
  editedId: string,
  matchId: string,
): ('upper' | 'lower')[] => {
  const slots: ('upper' | 'lower')[] = [];
  for (const feed of feeds) {
    if (feed.dst_match_id !== matchId) continue;
    if (feed.src_match_id === editedId || setIds.has(feed.src_match_id)) slots.push(feed.slot);
  }
  return slots;
};
