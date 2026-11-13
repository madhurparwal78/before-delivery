import type { Settings } from '../../shared/types.ts'
import type { Direction } from '../../shared/numbering.ts'
import { type PuzzleModel, type Position, type Clue } from './model.ts'

type Filled = (row: number, col: number) => boolean

/** Where the cursor lands on a clue: the first empty square of its word, or its first square when the word is full. */
export function landing(model: PuzzleModel, clue: Clue, filled: Filled): Position {
  const squares = model.squares(clue)
  const target = squares.find((square) => !filled(square.row, square.col)) ?? squares[0]
  return { row: target.row, col: target.col, direction: clue.direction }
}

/** The starting clue is the first one in clue order with an empty square, else the first clue. */
export function startPosition(model: PuzzleModel, filled: Filled): Position {
  const clue = model.clues.find((candidate) => model.squares(candidate).some((square) => !filled(square.row, square.col))) ?? model.clues[0]
  return landing(model, clue, filled)
}

/** The clue a Tab (+1), Shift+Tab (-1) or Alt+L-style step reaches from the active clue, wrapping. */
export function clueAfter(model: PuzzleModel, from: Clue, step: 1 | -1): Clue {
  const index = model.clues.indexOf(from)
  return model.clues[(index + step + model.clues.length) % model.clues.length]
}

/** One step along the active direction, jumping black squares; null at the grid edge. */
export function stepAlong(model: PuzzleModel, at: Position, rowStep: number, colStep: number): Position | null {
  let { row, col } = at
  do {
    row += rowStep
    col += colStep
    if (row < 0 || col < 0 || row >= model.puzzle.rows || col >= model.puzzle.cols) return null
  } while (!model.isWhite(row, col))
  return { ...at, row, col }
}

/**
 * The auto-advance rule: where the cursor goes after a letter (or a refused one). `filled` must already count the
 * written square as filled. With Skip filled squares on it goes to the next empty square later in the word, else the
 * first empty one earlier, else (full word) the next square. With it off it goes to the next square. With Jump to the
 * next clue on, a full word sends it to the next clue in clue order that still has an empty square.
 */
export function advance(model: PuzzleModel, at: Position, filled: Filled, settings: Settings): Position {
  const clue = model.clueAt(at.direction, at.row, at.col)
  if (!clue) return at
  const squares = model.squares(clue)
  const index = squares.findIndex((square) => square.row === at.row && square.col === at.col)
  const empty = (square: { row: number; col: number }): boolean => !filled(square.row, square.col)
  if (settings.jump_next_clue && squares.every((square) => !empty(square))) {
    for (let step = 1; step < model.clues.length; step++) {
      const candidate = model.clues[(model.clues.indexOf(clue) + step) % model.clues.length]
      if (model.squares(candidate).some(empty)) return landing(model, candidate, filled)
    }
  }
  const next = squares[Math.min(index + 1, squares.length - 1)]
  const target = settings.skip_filled ? (squares.slice(index + 1).find(empty) ?? squares.slice(0, index).find(empty) ?? next) : next
  return { ...at, row: target.row, col: target.col }
}

export const arrowSteps: Record<string, { direction: Direction; row: number; col: number }> = {
  ArrowUp: { direction: 'down', row: -1, col: 0 },
  ArrowDown: { direction: 'down', row: 1, col: 0 },
  ArrowLeft: { direction: 'across', row: 0, col: -1 },
  ArrowRight: { direction: 'across', row: 0, col: 1 },
}
