import type { PuzzleJson } from '../../shared/types.ts'
import { type Direction, type Word, clueOrder, wordSquares } from '../../shared/numbering.ts'
import type { ClueRef } from '../../shared/clues.ts'

export interface Position {
  row: number
  col: number
  direction: Direction
}

/** A word with its clue text and the clues linked to it. */
export interface Clue extends Word {
  text: string
  links: ClueRef[]
}

/** The words and clues of a puzzle, looked up by square or by clue. */
export class PuzzleModel {
  readonly clues: Clue[]
  private readonly byWord = new Map<string, Clue>()

  constructor(readonly puzzle: PuzzleJson) {
    const toClues = (direction: Direction): Clue[] => puzzle.clues[direction].map((clue) => ({ direction, number: clue.number, row: clue.row, col: clue.col, length: clue.length, text: clue.text, links: clue.links }))
    this.clues = clueOrder([...toClues('across'), ...toClues('down')])
    for (const clue of this.clues) for (const square of wordSquares(clue)) this.byWord.set(`${clue.direction}:${square.row},${square.col}`, clue)
  }

  /** The clue of the word through a square in a direction. */
  clueAt(direction: Direction, row: number, col: number): Clue | undefined {
    return this.byWord.get(`${direction}:${row},${col}`)
  }

  clueOf(ref: ClueRef): Clue | undefined {
    return this.clues.find((clue) => clue.number === ref.number && clue.direction === ref.direction)
  }

  isWhite(row: number, col: number): boolean {
    return this.puzzle.blocks[row]?.[col] === '.'
  }

  squares(clue: Clue): { row: number; col: number }[] {
    return wordSquares(clue)
  }
}

export const opposite = (direction: Direction): Direction => (direction === 'across' ? 'down' : 'across')
