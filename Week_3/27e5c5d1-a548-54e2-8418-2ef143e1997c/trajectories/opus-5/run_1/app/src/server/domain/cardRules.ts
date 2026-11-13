import type { CardStatus, DueState, MoverColour } from '../../shared/types';

const EDGES: Record<CardStatus, CardStatus[]> = {
  open: ['done', 'archived'],
  done: ['open', 'archived'],
  archived: ['open'],
};

/** The one place that knows the card status edges. */
export function canTransition(from: CardStatus, to: CardStatus): boolean {
  return EDGES[from].includes(to);
}

/** The one place that decides a card's due state, always from the workspace's time zone. */
export function dueState(dueDate: string | null, status: CardStatus, timeZone: string, now: Date): DueState | null {
  if (dueDate === null || status !== 'open') return null;
  const today = todayInZone(timeZone, now);
  if (dueDate === today) return 'due_today';
  return dueDate < today ? 'overdue' : 'upcoming';
}

export function todayInZone(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export interface RankedCard {
  id: string;
  visible: boolean;
}

/**
 * The one place that decides where a moved card lands.
 * `cards` are the target list's non-archived cards in rank order, without the moving card.
 * The result is a 0-based index into that array.
 */
export function placementIndex(cards: readonly RankedCard[], visiblePosition: number): number {
  const visible = cards.filter((card) => card.visible);
  const target = visible[visiblePosition - 1];
  if (target === undefined) return cards.length;
  return cards.findIndex((card) => card.id === target.id);
}

/** The highest `position` a caller may ask for when moving a card into this list. */
export function highestRequestablePosition(cards: readonly RankedCard[]): number {
  return cards.filter((card) => card.visible).length + 1;
}

export function initialsFor(displayName: string): string {
  const words = displayName.split(/\s+/u).filter((word) => word.length > 0);
  const first = words[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const firstLetter = [...first][0] ?? '';
  const lastLetter = last === undefined ? '' : ([...last][0] ?? '');
  return (firstLetter + lastLetter).toLocaleUpperCase();
}

const COLOUR_ORDER: MoverColour[] = ['sage', 'clay', 'plum', 'ochre', 'slate', 'rose'];

export function nextColour(previous: MoverColour | null): MoverColour {
  if (previous === null) return 'sage';
  const index = COLOUR_ORDER.indexOf(previous);
  return COLOUR_ORDER[(index + 1) % COLOUR_ORDER.length] as MoverColour;
}
