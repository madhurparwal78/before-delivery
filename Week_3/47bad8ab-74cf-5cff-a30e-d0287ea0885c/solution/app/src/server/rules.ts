import type { Colour, PlayerStats, Square, SquareMark, SquareReveal } from '../shared/types.ts'
import { type Direction, type Word, wordSquares } from '../shared/numbering.ts'
import { isLocked, marked } from '../shared/squares.ts'
import type { PuzzleData } from './puzzles.ts'

const key = (row: number, col: number): string => `${row},${col}`

const emptySquare = (row: number, col: number): Square => ({ row, col, value: '', pencil: false, state: 'empty', owner: null })

/** What a check, reveal or clear write acts on, resolved against the grid. */
type Target = { scope: 'puzzle' } | { scope: 'square'; row: number; col: number } | { scope: 'word'; row: number; col: number; direction: Direction; word: Word }

/** The squares of one game grid: stored squares override the empty default of every white square. */
export class Grid {
  readonly changed = new Set<string>()
  private readonly squares = new Map<string, Square>()

  constructor(readonly puzzle: PuzzleData, stored: readonly Square[]) {
    for (const square of stored) this.squares.set(key(square.row, square.col), square)
  }

  /** The coordinates when they name a white square of the grid. */
  squareAt(row: number | null, col: number | null): { row: number; col: number } | null {
    return row !== null && col !== null && this.puzzle.solution[row]?.[col] !== undefined && this.puzzle.solution[row][col] !== '#' ? { row, col } : null
  }

  answer(row: number, col: number): string {
    return this.puzzle.solution[row][col]
  }

  get(row: number, col: number): Square {
    return this.squares.get(key(row, col)) ?? emptySquare(row, col)
  }

  put(square: Square): void {
    this.squares.set(key(square.row, square.col), square)
    this.changed.add(key(square.row, square.col))
  }

  changedSquares(): Square[] {
    return [...this.changed].flatMap((at) => this.squares.get(at) ?? [])
  }

  all(): Square[] {
    return this.puzzle.solution.flatMap((line, row) => line.flatMap((answer, col) => (answer === '#' ? [] : [this.get(row, col)])))
  }

  wordAt(row: number, col: number, direction: Direction): Word | undefined {
    return this.puzzle.words.find((word) => word.direction === direction && wordSquares(word).some((square) => square.row === row && square.col === col))
  }

  /** The target a write names, or null when its scope, square or direction is not valid for this grid. */
  target(scope: unknown, row: number | null, col: number | null, direction: Direction | null): Target | null {
    if (scope === 'puzzle') return { scope }
    const at = this.squareAt(row, col)
    if (!at) return null
    if (scope === 'square') return { scope, ...at }
    const word = scope === 'word' && direction !== null ? this.wordAt(at.row, at.col, direction) : undefined
    return word && direction !== null ? { scope: 'word', ...at, direction, word } : null
  }

  squaresOf(target: Target): Square[] {
    if (target.scope === 'puzzle') return this.all()
    if (target.scope === 'square') return [this.get(target.row, target.col)]
    return wordSquares(target.word).map((square) => this.get(square.row, square.col))
  }

  /** The solve test: every white square's entry equals its answer, ignoring case. */
  isSolved(): boolean {
    return this.puzzle.solution.every((line, row) => line.every((answer, col) => answer === '#' || this.get(row, col).value === answer))
  }
}

interface Writer {
  colour: Colour
  autocheck: boolean
}

/** Writes one entry. A writer with Autocheck on has their own pen entry checked in the same step. */
export function writeSquare(grid: Grid, writer: Writer, row: number, col: number, value: string, pencil: boolean): { square: Square; autocheck: boolean } {
  const entry = value.toUpperCase()
  const autocheck = writer.autocheck && !pencil && entry !== ''
  const state = entry === '' ? 'empty' : autocheck ? (entry === grid.answer(row, col) ? 'right' : 'wrong') : pencil ? 'pencil' : 'filled'
  const square: Square = { row, col, value: entry, pencil: entry !== '' && pencil, state, owner: entry === '' ? null : writer.colour }
  grid.put(square)
  return { square, autocheck }
}

export function checkSquares(grid: Grid, squares: readonly Square[]): { marks: SquareMark[]; wrong: number } {
  const marks: SquareMark[] = []
  for (const square of squares) {
    if (square.value === '' || isLocked(square)) continue
    const state = square.value === grid.answer(square.row, square.col) ? 'right' : 'wrong'
    grid.put(marked(square, state))
    marks.push({ row: square.row, col: square.col, state })
  }
  return { marks, wrong: marks.filter((mark) => mark.state === 'wrong').length }
}

export function revealSquares(grid: Grid, squares: readonly Square[], revealer: Colour): SquareReveal[] {
  const revealed: SquareReveal[] = []
  for (const square of squares) {
    if (isLocked(square)) continue
    const value = grid.answer(square.row, square.col)
    grid.put({ row: square.row, col: square.col, value, pencil: false, state: 'revealed', owner: revealer })
    revealed.push({ row: square.row, col: square.col, value, state: 'revealed', owner: revealer })
  }
  return revealed
}

/** The Clear word protection rule: a square whose crossing word is full is kept, unless nothing else is left to clear. */
function wordClearTargets(grid: Grid, target: Extract<Target, { scope: 'word' }>): Square[] {
  const crossing: Direction = target.direction === 'across' ? 'down' : 'across'
  const full = (word: Word): boolean => wordSquares(word).every((square) => grid.get(square.row, square.col).value !== '')
  const candidates = grid.squaresOf(target).filter((square) => square.value !== '' && !isLocked(square))
  const unprotected = candidates.filter((square) => {
    const across = grid.wordAt(square.row, square.col, crossing)
    return across === undefined || !full(across)
  })
  return unprotected.length > 0 ? unprotected : candidates
}

export function clearSquares(grid: Grid, target: Exclude<Target, { scope: 'square' }>): SquareMark[] {
  const squares = target.scope === 'puzzle' ? grid.all().filter((square) => square.value !== '' && !isLocked(square)) : wordClearTargets(grid, target)
  return squares.map((square) => {
    grid.put(emptySquare(square.row, square.col))
    return { row: square.row, col: square.col, state: 'empty' as const }
  })
}

/** Race claim: a right check writes the answer into the grid as a locked, right square. */
export function claimSquare(grid: Grid, square: Square, claimer: Colour): SquareReveal {
  const value = grid.answer(square.row, square.col)
  grid.put({ row: square.row, col: square.col, value, pencil: false, state: 'right', owner: claimer })
  return { row: square.row, col: square.col, value, state: 'right', owner: claimer }
}

export function solveStats(finalSquares: readonly Square[], players: readonly { id: string; colour: Colour }[]): PlayerStats[] {
  return players.map((player) => ({
    player_id: player.id,
    letters: finalSquares.filter((square) => square.owner === player.colour && square.state !== 'revealed').length,
    revealed: finalSquares.filter((square) => square.owner === player.colour && square.state === 'revealed').length,
  }))
}

