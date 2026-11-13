import type { ListState } from './api-types'

const LEGAL: Record<ListState, readonly ListState[]> = {
  planning: ['packed'],
  packed: ['planning', 'walked'],
  walked: [],
}

export function isListState(value: unknown): value is ListState {
  return value === 'planning' || value === 'packed' || value === 'walked'
}

export function canMove(from: ListState, to: ListState): boolean {
  return LEGAL[from].includes(to)
}

export function illegalTransitionMessage(from: ListState, to: ListState): string {
  return `Cannot move a ${from} list to ${to}.`
}

/** The state actions the workspace offers from a state. */
export function legalMoves(from: ListState): readonly ListState[] {
  return LEGAL[from]
}

export function notEditableMessage(listName: string, state: ListState): string {
  return `${listName} is ${state} and can't be edited.`
}
