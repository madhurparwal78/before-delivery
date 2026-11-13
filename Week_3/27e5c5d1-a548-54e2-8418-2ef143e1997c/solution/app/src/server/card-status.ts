import type { CardStatus } from '../shared/types.ts';

/** The legal status edges; anything else is an invalid transition. */
const EDGES: Record<CardStatus, CardStatus[]> = {
  open: ['done', 'archived'],
  done: ['open', 'archived'],
  archived: ['open'],
};

export const canTransition = (from: CardStatus, to: CardStatus): boolean => EDGES[from].includes(to);
