import { CLUE_MAX, authorProblem, clueTooLong, titleProblem } from '../shared/limits.ts'
import { slug } from '../shared/text.ts'
import { type ClueRef, badReference, isStarred } from '../shared/clues.ts'
import { type Direction, type Numbering, type Word, clueOrder, directionName, numberGrid, orphanSquares } from '../shared/numbering.ts'

export const SYMMETRIES = ['None', 'Rotational', 'Left-right', 'Top-bottom', 'Diagonal'] as const
export type Symmetry = (typeof SYMMETRIES)[number]

const DEFAULT_SYMMETRY_AREA = 49

export interface Draft {
  cols: number
  rows: number
  title: string
  author: string
  symmetry: Symmetry
  /** Row-major letters; `#` is a black square and an empty string a white square without a letter. */
  squares: string[][]
  /** Clue text by the start square of its word, for example `across:0,0`. */
  clues: Map<string, string>
}

export const blank = (cols: number, rows: number): string[][] => Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))

export const defaultSymmetry = (cols: number, rows: number): Symmetry => (cols * rows < DEFAULT_SYMMETRY_AREA ? 'None' : 'Rotational')

export const clueKey = (word: Word): string => `${word.direction}:${word.row},${word.col}`

/** The square that toggles together with (row, col) under the chosen symmetry. */
export function partner(draft: Draft, row: number, col: number): [number, number] {
  switch (draft.symmetry) {
    case 'Rotational':
      return [draft.rows - 1 - row, draft.cols - 1 - col]
    case 'Left-right':
      return [row, draft.cols - 1 - col]
    case 'Top-bottom':
      return [draft.rows - 1 - row, col]
    case 'Diagonal':
      return [col, row]
    case 'None':
      return [row, col]
  }
}

export const numbering = (draft: Draft): Numbering => numberGrid(draft.rows, draft.cols, (row, col) => draft.squares[row][col] !== '#')

export const wordsOf = (draft: Draft): Word[] => clueOrder(numbering(draft).words)

const clueText = (draft: Draft, word: Word): string => draft.clues.get(clueKey(word)) ?? ''

/** How many separate groups the white squares form (squares join side to side). */
function whiteGroups(draft: Draft): number {
  const seen = new Set<string>()
  let groups = 0
  draft.squares.forEach((line, row) =>
    line.forEach((square, col) => {
      if (square === '#' || seen.has(`${row},${col}`)) return
      groups += 1
      for (const todo = [[row, col]]; todo.length > 0; ) {
        const [r, c] = todo.pop() ?? []
        if (seen.has(`${r},${c}`) || draft.squares[r]?.[c] === undefined || draft.squares[r][c] === '#') continue
        seen.add(`${r},${c}`)
        todo.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1])
      }
    }),
  )
  return groups
}

/** The builder's problems, in the published order. */
export function problemsOf(draft: Draft): string[] {
  const problems: string[] = []
  const isWhite = (row: number, col: number): boolean => draft.squares[row][col] !== '#'
  problems.push(...[titleProblem(draft.title.trim()), authorProblem(draft.author.trim())].flatMap((problem) => problem ?? []))
  const words = wordsOf(draft)
  for (const { row, col } of orphanSquares(draft.rows, draft.cols, isWhite)) problems.push(`Square at row ${row + 1}, column ${col + 1} is not part of any word`)
  if (whiteGroups(draft) > 1) problems.push('The white squares are not all connected')
  draft.squares.forEach((line, row) => {
    const empty = line.filter((square) => square === '').length
    if (empty > 0) problems.push(`Row ${row + 1} has ${empty === 1 ? '1 empty square' : `${empty} empty squares`}`)
  })
  const exists = (ref: ClueRef): boolean => words.some((word) => word.number === ref.number && word.direction === ref.direction)
  const anyStarred = words.some((word) => isStarred(clueText(draft, word).trim()))
  for (const word of words) {
    const text = clueText(draft, word).trim()
    const label = `${word.number} ${directionName(word.direction)}`
    const bad = badReference(text, exists, anyStarred)
    if (text === '') problems.push(`${label} has no clue`)
    else if (clueTooLong(text)) problems.push(`${label} clue is longer than ${CLUE_MAX} characters`)
    else if (bad) problems.push(`${label} refers to ${bad}`)
  }
  return problems
}

/** The one text of the builder's puzzle: Download text and Save to my puzzles both send exactly this. */
export function draftText(draft: Draft): string {
  const words = wordsOf(draft)
  const block = (direction: Direction): string[] => words.filter((word) => word.direction === direction).map((word) => `${word.number}. ${clueText(draft, word).trim()}`)
  return [
    'Overlap 1',
    `Title: ${draft.title.trim()}`,
    `Author: ${draft.author.trim()}`,
    `Size: ${draft.cols}x${draft.rows}`,
    '',
    'Grid:',
    ...draft.squares.map((line) => line.join('')),
    '',
    'Across:',
    ...block('across'),
    '',
    'Down:',
    ...block('down'),
    '',
  ].join('\n')
}

export const fileName = (title: string): string => `${slug(title) || 'puzzle'}.overlap.txt`
