import type { ClueJson, Solution } from '../shared/types.ts'
import { type ClueRef, type ClueText, badReference, isStarred, linkedClues } from '../shared/clues.ts'
import { CLUE_MAX, MIN_GRID, authorProblem, clueTooLong, isEntry, titleProblem } from '../shared/limits.ts'
import { type Direction, clueOrder, directionName, numberGrid, orphanSquares } from '../shared/numbering.ts'

const LISTED_PROBLEMS = 20

export interface ParsedPuzzle {
  title: string
  author: string
  cols: number
  rows: number
  solution: Solution
  numbers: { row: number; col: number; number: number }[]
  clues: { across: ClueJson[]; down: ClueJson[] }
}

type Problems = { problems: string[]; count: number }
type ParseResult = { puzzle: ParsedPuzzle } | Problems

interface Line {
  n: number
  text: string
}

interface Problem {
  n: number
  message: string
}

type GridSquare = string | null

const decoder = new TextDecoder('utf-8', { fatal: true })
const SIZE = /^([0-9]+)x([0-9]+)$/
const CLUE_LINE = /^([0-9]+)\. +(\S.*)$/

/** The lines before the first line that is not UTF-8, and that line's number. */
function readLines(bytes: Uint8Array): { lines: Line[]; badLine: number | null; lastLine: number } {
  const pieces: Uint8Array[] = []
  let start = 0
  bytes.forEach((byte, i) => {
    if (byte === 0x0a) {
      pieces.push(bytes.subarray(start, i))
      start = i + 1
    }
  })
  if (start < bytes.length) pieces.push(bytes.subarray(start))
  const lines: Line[] = []
  for (const [index, piece] of pieces.entries()) {
    const raw = piece.at(-1) === 0x0d ? piece.subarray(0, -1) : piece
    let text: string
    try {
      text = decoder.decode(raw)
    } catch {
      return { lines, badLine: index + 1, lastLine: pieces.length }
    }
    if (index === 0 && text.startsWith('﻿')) text = text.slice(1)
    lines.push({ n: index + 1, text: text.replace(/ +$/, '') })
  }
  return { lines, badLine: null, lastLine: pieces.length }
}

/** One grid line: its squares, or its first problem (bad character, then rebus content, then rebus not closed). */
function readGridLine(text: string): { squares: GridSquare[] } | { problem: string } {
  const squares: GridSquare[] = []
  let badCharacter: string | null = null
  let badRebus: string | null = null
  let unclosed = false
  const chars = [...text]
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    if (char === '#') squares.push(null)
    else if (/^[A-Za-z]$/.test(char)) squares.push(char.toUpperCase())
    else if (char === '{') {
      const close = chars.indexOf('}', i + 1)
      if (close < 0) {
        unclosed = true
        break
      }
      const content = chars.slice(i + 1, close).join('')
      if (!isEntry(content)) badRebus ??= `rebus {${content}} must be 1 to 8 letters or digits`
      squares.push(content.toUpperCase())
      i = close
    } else badCharacter ??= `unexpected character ${char} in grid row`
  }
  const problem = badCharacter ?? badRebus ?? (unclosed ? 'rebus brace is not closed' : null)
  return problem === null ? { squares } : { problem }
}

interface Clue {
  number: number
  body: string
}

export function parseOverlap(bytes: Uint8Array, maxGrid: number): ParseResult {
  const { lines, badLine, lastLine } = readLines(bytes)
  const problems: Problem[] = []
  const add = (n: number, message: string): void => void problems.push({ n, message })
  const finish = (): Problems => {
    const sorted = [...problems].sort((a, b) => a.n - b.n)
    return { problems: sorted.slice(0, LISTED_PROBLEMS).map(({ n, message }) => `Line ${n}: ${message}`), count: sorted.length }
  }
  // Checking stops at the first line that is not UTF-8: it is reported and nothing after it is read.
  const truncated = (): Problems | null => {
    if (badLine === null) return null
    add(badLine, 'file is not valid UTF-8')
    return finish()
  }
  const stopAt = (n: number | undefined, message: string): Problems => {
    if (n === undefined && badLine !== null) add(badLine, 'file is not valid UTF-8')
    else add(n ?? lastLine + 1, message)
    return finish()
  }

  if (lines[0]?.text !== 'Overlap 1') return stopAt(lines.length === 0 ? undefined : 1, 'first line must be Overlap 1')

  const rest = lines.slice(1).filter((line) => line.text !== '')
  let at = 0
  const header = (key: 'Title' | 'Author' | 'Size'): { line: Line; value: string } | Problems => {
    const line = rest[at]
    if (line === undefined || !line.text.startsWith(`${key}:`)) return stopAt(line?.n, `expected the ${key}: line`)
    at += 1
    return { line, value: line.text.slice(key.length + 1).trim() }
  }

  const title = header('Title')
  if ('problems' in title) return title
  const badTitle = titleProblem(title.value)
  if (badTitle) add(title.line.n, badTitle)
  const author = header('Author')
  if ('problems' in author) return author
  const badAuthor = authorProblem(author.value)
  if (badAuthor) add(author.line.n, badAuthor)
  const size = header('Size')
  if ('problems' in size) return size

  let cols = 0
  let rows = 0
  const sizeMatch = SIZE.exec(size.value)
  if (!sizeMatch) add(size.line.n, 'Size must look like 15x15')
  else {
    const [wide, high] = [Number(sizeMatch[1]), Number(sizeMatch[2])]
    if ([wide, high].some((side) => side < MIN_GRID || side > maxGrid)) add(size.line.n, `grid size must be from 3x3 to ${maxGrid}x${maxGrid}`)
    else [cols, rows] = [wide, high]
  }
  const sizeGood = cols > 0

  const gridHeading = rest[at]
  if (gridHeading === undefined || gridHeading.text !== 'Grid:') return stopAt(gridHeading?.n, 'expected the Grid: line')
  const gridLines: Line[] = []
  for (const line of lines.slice(gridHeading.n)) {
    if (line.text === '' || line.text === 'Across:') break
    gridLines.push(line)
  }
  const grid: GridSquare[][] = []
  let gridProblem = false
  for (const line of gridLines) {
    const read = readGridLine(line.text)
    if ('problem' in read) {
      add(line.n, read.problem)
      gridProblem = true
      continue
    }
    grid.push(read.squares)
    if (sizeGood && read.squares.length !== cols) {
      add(line.n, `grid row has ${read.squares.length} squares, expected ${cols}`)
      gridProblem = true
    }
  }
  const lastGridLine = gridLines.at(-1)?.n ?? gridHeading.n
  const acrossHeading = lines.find((line) => line.n > lastGridLine && line.text !== '')
  if (acrossHeading === undefined) {
    const cut = truncated()
    if (cut) return cut
  }
  if (sizeGood && gridLines.length !== rows) {
    add(gridHeading.n, `grid has ${gridLines.length} rows, expected ${rows}`)
    gridProblem = true
  }
  const isWhite = (row: number, col: number): boolean => grid[row]?.[col] != null
  if (sizeGood && !gridProblem) {
    for (const orphan of orphanSquares(rows, cols, isWhite)) {
      const line = gridLines[orphan.row]
      if (problems.some((problem) => problem.n === line.n)) continue
      add(line.n, `square at row ${orphan.row + 1}, column ${orphan.col + 1} is not part of any word`)
      gridProblem = true
    }
  }

  if (acrossHeading === undefined || acrossHeading.text !== 'Across:') return stopAt(acrossHeading?.n, 'expected the Across: line')
  const downHeading = lines.find((line) => line.n > acrossHeading.n && line.text === 'Down:')
  const matching = sizeGood && !gridProblem
  const numbering = matching ? numberGrid(rows, cols, isWhite) : null
  const wordExists = (ref: ClueRef): boolean => numbering?.words.some((word) => word.number === ref.number && word.direction === ref.direction) ?? false
  const clueLines = lines.filter((line) => line.n > acrossHeading.n && line.text !== '' && line.n !== downHeading?.n)
  const syntax = clueLines.map((line) => ({ line, match: CLUE_LINE.exec(line.text) }))
  const anyStarred = syntax.some(({ match }) => match !== null && isStarred(match[2]))

  const checkBlock = (direction: Direction, from: number, to: number): Clue[] => {
    const kept: Clue[] = []
    const seen = new Set<number>()
    for (const { line, match } of syntax.filter(({ line }) => line.n > from && line.n < to)) {
      if (!match) {
        add(line.n, 'clue must look like 12. Clue text')
        continue
      }
      const number = Number(match[1])
      const body = match[2]
      const label = `${number} ${directionName(direction)}`
      let problem: string | null = null
      if (clueTooLong(body)) problem = `clue ${label} is longer than ${CLUE_MAX} characters`
      else if (matching && !wordExists({ number, direction })) problem = `clue ${label} has no matching word in the grid`
      else {
        const bad = matching ? badReference(body, wordExists, anyStarred) : null
        if (bad) problem = `clue ${label} refers to ${bad}`
        else if (seen.has(number)) problem = `clue ${label} appears twice`
      }
      if (problem) add(line.n, problem)
      if (!seen.has(number) && !problem?.includes('no matching word')) kept.push({ number, body })
      seen.add(number)
    }
    return kept
  }

  const acrossClues = checkBlock('across', acrossHeading.n, downHeading?.n ?? Infinity)
  if (downHeading === undefined) return stopAt(undefined, 'expected the Down: line')
  const downClues = checkBlock('down', downHeading.n, Infinity)
  const cut = truncated()
  if (cut) return cut

  if (numbering) {
    for (const [direction, heading, clues] of [['across', acrossHeading, acrossClues], ['down', downHeading, downClues]] as const) {
      const have = new Set(clues.map((clue) => clue.number))
      const missing = numbering.words.filter((word) => word.direction === direction && !have.has(word.number)).map((word) => `${word.number} ${directionName(direction)}`)
      if (missing.length > 0) add(heading.n, `missing clue for ${missing.join(', ')}`)
    }
  }
  if (problems.length > 0 || !numbering) return finish()

  const text = new Map<string, string>()
  for (const [direction, clues] of [['across', acrossClues], ['down', downClues]] as const) for (const clue of clues) text.set(`${direction}:${clue.number}`, clue.body.trim())
  const ordered = clueOrder(numbering.words)
  const clueTexts: ClueText[] = ordered.map((word) => ({ number: word.number, direction: word.direction, text: text.get(`${word.direction}:${word.number}`) ?? '' }))
  const links = linkedClues(clueTexts)
  const across: ClueJson[] = []
  const down: ClueJson[] = []
  ordered.forEach((word, i) => {
    const clue: ClueJson = { number: word.number, row: word.row, col: word.col, length: word.length, text: clueTexts[i].text, links: links.get(clueTexts[i]) ?? [] }
    ;(word.direction === 'across' ? across : down).push(clue)
  })
  const solution: Solution = grid.map((row) => row.map((square) => square ?? '#'))
  return { puzzle: { title: title.value, author: author.value, cols, rows, solution, numbers: numbering.numbers, clues: { across, down } } }
}
