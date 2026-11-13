import type { Square, SquareState } from './types.ts'

/** Right and revealed squares are locked: every write to them is refused. */
export const isLocked = (square: Pick<Square, 'state'>): boolean => square.state === 'right' || square.state === 'revealed'

/** A square after a check or reveal mark: a locked square is never pencil. */
export const marked = (square: Square, state: SquareState): Square => ({ ...square, state, pencil: state === 'right' || state === 'revealed' ? false : square.pencil })
