export type Direction = 'across' | 'down'

export interface Word {
  direction: Direction
  number: number
  row: number
  col: number
  length: number
}

export interface Numbering {
  numbers: { row: number; col: number; number: number }[]
  words: Word[]
}

/** Overlap numbering: scan rows top to bottom, squares left to right; a white square that starts an
 * Across or a Down word takes the next number. A word is a run of two or more white squares. */
export function numberGrid(rows: number, cols: number, isWhite: (row: number, col: number) => boolean): Numbering {
  const white = (row: number, col: number): boolean => row >= 0 && col >= 0 && row < rows && col < cols && isWhite(row, col)
  const numbers: Numbering['numbers'] = []
  const words: Word[] = []
  let next = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!white(row, col)) continue
      const startsAcross = !white(row, col - 1) && white(row, col + 1)
      const startsDown = !white(row - 1, col) && white(row + 1, col)
      if (!startsAcross && !startsDown) continue
      next += 1
      numbers.push({ row, col, number: next })
      if (startsAcross) {
        let length = 0
        while (white(row, col + length)) length += 1
        words.push({ direction: 'across', number: next, row, col, length })
      }
      if (startsDown) {
        let length = 0
        while (white(row + length, col)) length += 1
        words.push({ direction: 'down', number: next, row, col, length })
      }
    }
  }
  return { numbers, words }
}

export function wordSquares(word: Word): { row: number; col: number }[] {
  return Array.from({ length: word.length }, (_, i) => ({
    row: word.row + (word.direction === 'down' ? i : 0),
    col: word.col + (word.direction === 'across' ? i : 0),
  }))
}

/** Clue order: every Across clue by number, then every Down clue by number. */
export function clueOrder<T extends { direction: Direction; number: number }>(words: readonly T[]): T[] {
  return [...words].sort((a, b) => (a.direction === b.direction ? a.number - b.number : a.direction === 'across' ? -1 : 1))
}

export function directionName(direction: Direction): 'Across' | 'Down' {
  return direction === 'across' ? 'Across' : 'Down'
}

/** White squares that belong to no word, row by row. */
export function orphanSquares(rows: number, cols: number, isWhite: (row: number, col: number) => boolean): { row: number; col: number }[] {
  const covered = new Set(numberGrid(rows, cols, isWhite).words.flatMap((word) => wordSquares(word).map((square) => `${square.row},${square.col}`)))
  return Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => ({ row, col }))).flat().filter(({ row, col }) => isWhite(row, col) && !covered.has(`${row},${col}`))
}
