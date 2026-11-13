import type { ListState } from './types.js';

const LEGAL_MOVES: ReadonlyArray<readonly [ListState, ListState]> = [
  ['planning', 'packed'],
  ['packed', 'planning'],
  ['packed', 'walked'],
];

/** The trip-list state machine, decided only here. */
export function isLegalMove(from: ListState, to: ListState): boolean {
  return LEGAL_MOVES.some(([a, b]) => a === from && b === to);
}

export function illegalTransitionMessage(from: ListState, to: ListState): string {
  return `Cannot move a ${from} list to ${to}.`;
}

export function isEditable(state: ListState): boolean {
  return state === 'planning';
}

export function isListState(value: unknown): value is ListState {
  return value === 'planning' || value === 'packed' || value === 'walked';
}
