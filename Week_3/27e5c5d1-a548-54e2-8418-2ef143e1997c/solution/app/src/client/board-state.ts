import type { BoardView, Card, ListCount, ListView, LiveEvent, Role, Visibility } from '../shared/types.ts';

/** The open board as the server last described it, plus what the person has changed and not yet confirmed. */
export interface BoardData {
  id: string;
  name: string;
  visibility: Visibility;
  workspaceId: string;
  parentName: string;
  role: Role;
  lists: ListView[];
}

export const toBoardData = (view: BoardView): BoardData => ({ ...view.board, role: view.role, lists: view.lists });

interface Place {
  list: ListView;
  index: number;
  card: Card;
}

export function locate(board: BoardData, cardId: string): Place | null {
  for (const list of board.lists) {
    const index = list.cards.findIndex((card) => card.id === cardId);
    const card = list.cards[index];
    if (card) return { list, index, card };
  }
  return null;
}

export const listById = (board: BoardData, listId: string): ListView | undefined => board.lists.find((list) => list.id === listId);

export function removeCard(board: BoardData, cardId: string): BoardData {
  return { ...board, lists: board.lists.map((list) => (list.cards.some((c) => c.id === cardId) ? { ...list, cards: list.cards.filter((c) => c.id !== cardId) } : list)) };
}

/** Puts a card at `index` of a list (clamped), taking it out of wherever it was. */
export function placeCard(board: BoardData, card: Card, listId: string, index: number): BoardData {
  const cleared = removeCard(board, card.id);
  return {
    ...cleared,
    lists: cleared.lists.map((list) => {
      if (list.id !== listId) return list;
      const cards = [...list.cards];
      cards.splice(Math.max(0, Math.min(index, cards.length)), 0, { ...card, listId });
      return { ...list, cards };
    }),
  };
}

/** True when every list holds the same cards in the same order, so nothing on screen has a new place. */
export function sameOrder(a: BoardData, b: BoardData): boolean {
  return (
    a.lists.length === b.lists.length &&
    a.lists.every((list, i) => {
      const other = b.lists[i];
      return other !== undefined && other.id === list.id && other.cards.length === list.cards.length && list.cards.every((c, j) => other.cards[j]?.id === c.id);
    })
  );
}

export function withCounts(board: BoardData, counts: ListCount[]): BoardData {
  return { ...board, lists: board.lists.map((list) => ({ ...list, count: counts.find((c) => c.listId === list.id)?.count ?? list.count })) };
}

export function replaceCard(board: BoardData, card: Card): BoardData {
  return { ...board, lists: board.lists.map((list) => ({ ...list, cards: list.cards.map((c) => (c.id === card.id ? card : c)) })) };
}

export function mapCard(board: BoardData, cardId: string, change: (card: Card) => Card): BoardData {
  const found = locate(board, cardId);
  return found ? replaceCard(board, change(found.card)) : board;
}

/** A card event older than what the board already holds is ignored. */
const isOlder = (board: BoardData, card: Card): boolean => {
  const held = locate(board, card.id);
  return held !== null && card.version < held.card.version;
};

/** Applies one live event to the board (the lifted-card and announcement rules live in the store). */
export function applyEvent(board: BoardData, event: LiveEvent): BoardData {
  switch (event.type) {
    case 'card.created': {
      const { card, counts } = event.data;
      return withCounts(placeCard(board, card, card.listId, (card.position ?? 1) - 1), counts);
    }
    case 'card.updated': {
      const { card } = event.data;
      if (isOlder(board, card)) return board;
      return locate(board, card.id) ? replaceCard(board, card) : board;
    }
    case 'card.moved': {
      const { card, to, counts } = event.data;
      if (isOlder(board, card)) return board;
      return withCounts(placeCard(board, card, to.listId, to.position - 1), counts);
    }
    case 'card.removed':
      return withCounts(removeCard(board, event.data.cardId), event.data.counts);
    case 'list.created':
      return board.lists.some((l) => l.id === event.data.list.id) ? board : { ...board, lists: [...board.lists, { ...event.data.list, count: 0, cards: [] }] };
    case 'list.updated':
      return { ...board, lists: board.lists.map((l) => (l.id === event.data.list.id ? { ...l, name: event.data.list.name } : l)) };
    case 'board.updated':
      return { ...board, name: event.data.board.name, visibility: event.data.board.visibility };
    default:
      return board;
  }
}

export type ViewMode = 'phone' | 'tablet' | 'desktop';

/** The published breakpoints: one list, the selected list and its neighbour, or every list. */
export function visibleListIds(board: BoardData, selectedId: string | null, mode: ViewMode): string[] {
  const ids = board.lists.map((list) => list.id);
  if (mode === 'desktop') return ids;
  const at = Math.max(0, ids.indexOf(selectedId ?? ''));
  if (mode === 'phone') return ids.slice(at, at + 1);
  if (ids.length < 2) return ids;
  return at + 1 < ids.length ? ids.slice(at, at + 2) : ids.slice(at - 1, at + 1);
}
