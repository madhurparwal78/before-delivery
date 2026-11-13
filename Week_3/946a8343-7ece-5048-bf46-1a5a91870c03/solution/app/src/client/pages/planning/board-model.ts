// Pure board logic: where a card sits while it is lifted, what a move does to the lists before the server answers, and how the
// server's answer is folded back in. Positions are 0-based indexes among the list's cards without the moving card.
import type { BoardCard, BoardList, MoveOutcome } from "./types.ts";

export interface Lift {
  issue: number;
  fromListId: number;
  listId: number;
  index: number;
}

export interface PendingMove {
  id: number;
  issue: number;
  fromListId: number;
  toListId: number;
  afterId: number | null;
}

export function cardKey(listId: number, issue: number): string {
  return `${listId}:${issue}`;
}

function without(cards: readonly BoardCard[], issue: number): BoardCard[] {
  return cards.filter((card) => card.issue !== issue);
}

/** Moves a card to `index` of the target list (counted without the card). Unknown lists or cards leave the lists unchanged. */
function placeCard(lists: readonly BoardList[], issue: number, fromListId: number, toListId: number, index: number): BoardList[] {
  const source = lists.find((list) => list.id === fromListId)?.cards.find((card) => card.issue === issue);
  if (source === undefined || !lists.some((list) => list.id === toListId)) return [...lists];
  return lists.map((list) => {
    let cards = list.cards;
    if (list.id === fromListId) cards = without(cards, issue);
    if (list.id === toListId) {
      const rest = without(cards, issue);
      const at = Math.max(0, Math.min(index, rest.length));
      cards = [...rest.slice(0, at), source, ...rest.slice(at)];
    }
    return cards === list.cards ? list : { ...list, cards };
  });
}

/** The index a card dropped under `afterId` takes in a list; the end of the list when that card is not there any more. */
function indexAfter(list: BoardList, issue: number, afterId: number | null): number {
  const rest = without(list.cards, issue);
  if (afterId === null) return 0;
  const at = rest.findIndex((card) => card.issue === afterId);
  return at < 0 ? rest.length : at + 1;
}

/** The card above a drop position, or null at the top. */
export function afterIdAt(list: BoardList, issue: number, index: number): number | null {
  const rest = without(list.cards, issue);
  const above = rest[Math.min(index, rest.length) - 1];
  return index <= 0 || above === undefined ? null : above.issue;
}

export function withLift(lists: readonly BoardList[], lift: Lift | null): BoardList[] {
  return lift === null ? [...lists] : placeCard(lists, lift.issue, lift.fromListId, lift.listId, lift.index);
}

export function applyPending(lists: readonly BoardList[], moves: readonly PendingMove[]): BoardList[] {
  let next = [...lists];
  for (const move of moves) {
    const target = next.find((list) => list.id === move.toListId);
    if (target === undefined) continue;
    const from = next.some((list) => list.id === move.fromListId && list.cards.some((card) => card.issue === move.issue))
      ? move.fromListId
      : (next.find((list) => list.cards.some((card) => card.issue === move.issue))?.id ?? move.fromListId);
    next = placeCard(next, move.issue, from, move.toListId, indexAfter(target, move.issue, move.afterId));
  }
  return next;
}

/** Folds the server's answer to a move into the lists: the moved card's new facts and the order of every list. */
export function applyOutcome(lists: readonly BoardList[], outcome: MoveOutcome): BoardList[] {
  const known = new Map<number, BoardCard>();
  for (const list of lists) for (const card of list.cards) known.set(card.issue, card);
  if (outcome.card !== null && known.has(outcome.card.issue)) known.set(outcome.card.issue, { ...outcome.card, project: outcome.card.project ?? known.get(outcome.card.issue)?.project ?? null });
  const order = new Map(outcome.order.map((entry) => [entry.id, entry.issueIds]));
  return lists.map((list) => {
    const ids = order.get(list.id);
    if (ids === undefined) return list;
    const cards: BoardCard[] = [];
    for (const id of ids) {
      const card = known.get(id);
      if (card !== undefined) cards.push(card);
    }
    return { ...list, cards };
  });
}

export function findCard(lists: readonly BoardList[], issue: number): { list: BoardList; card: BoardCard } | null {
  for (const list of lists) {
    const card = list.cards.find((entry) => entry.issue === issue);
    if (card !== undefined) return { list, card };
  }
  return null;
}

export function cardLabel(card: BoardCard, listTitle: string): string {
  const weight = card.weight === null ? "no weight" : `weight ${card.weight}`;
  const reference = card.project === null ? `#${card.iid}` : `${card.project}#${card.iid}`;
  return `Issue ${reference}, ${card.title}, ${weight}, ${card.labels.length} labels, in ${listTitle}`;
}

export function issueCountText(count: number): string {
  return count === 1 ? "1 issue" : `${count} issues`;
}
