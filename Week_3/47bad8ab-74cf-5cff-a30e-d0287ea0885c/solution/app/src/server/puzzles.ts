import { createHash, randomUUID } from 'node:crypto'
import type { ClueJson, PuzzleJson, PuzzleListEntry, Solution } from '../shared/types.ts'
import { type Word, numberGrid } from '../shared/numbering.ts'
import { config } from './config.ts'
import { type Queryable, pool, transaction } from './db.ts'
import { ApiError, invalid } from './errors.ts'
import { LIBRARY } from './library.ts'
import { type ParsedPuzzle, parseOverlap } from './parse.ts'
import { getObject, putObject } from './s3.ts'

export interface PuzzleData {
  id: string
  title: string
  author: string
  cols: number
  rows: number
  source: 'library' | 'upload'
  fixture: string | null
  sha256: string | null
  ownerId: string | null
  createdAt: Date
  solution: Solution
  numbers: { row: number; col: number; number: number }[]
  clues: { across: ClueJson[]; down: ClueJson[] }
  words: Word[]
}

interface PuzzleRow {
  id: string
  title: string
  author: string
  cols: number
  rows: number
  source: 'library' | 'upload'
  fixture: string | null
  sha256: string | null
  owner_id: string | null
  created_at: Date
  solution: Solution
  numbers: PuzzleData['numbers']
  clues: PuzzleData['clues']
}

const SIZE_BOUNDS = { small: [0, 7], medium: [8, 12], large: [13, Infinity] } as const
type SizeFilter = keyof typeof SIZE_BOUNDS
const SIZE_FILTERS = Object.keys(SIZE_BOUNDS) as SizeFilter[]
const SOURCE_FILTERS = ['library', 'mine'] as const
type SourceFilter = (typeof SOURCE_FILTERS)[number]

const cache = new Map<string, PuzzleData>()

function toData(row: PuzzleRow): PuzzleData {
  const white = (r: number, c: number): boolean => row.solution[r][c] !== '#'
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    cols: row.cols,
    rows: row.rows,
    source: row.source,
    fixture: row.fixture,
    sha256: row.sha256,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    solution: row.solution,
    numbers: row.numbers,
    clues: row.clues,
    words: numberGrid(row.rows, row.cols, white).words,
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function loadPuzzle(id: string, db: Queryable = pool): Promise<PuzzleData | null> {
  if (!UUID.test(id)) return null
  const cached = cache.get(id)
  if (cached) return cached
  const { rows } = await db.query<PuzzleRow>('SELECT * FROM puzzles WHERE id = $1', [id])
  if (rows.length === 0) return null
  const data = toData(rows[0])
  cache.set(id, data)
  return data
}

export function puzzleJson(puzzle: PuzzleData): PuzzleJson {
  return {
    id: puzzle.id,
    title: puzzle.title,
    author: puzzle.author,
    cols: puzzle.cols,
    rows: puzzle.rows,
    source: puzzle.source,
    fixture: puzzle.fixture,
    sha256: puzzle.sha256,
    created_at: puzzle.createdAt.toISOString(),
    blocks: puzzle.solution.map((row) => row.map((square) => (square === '#' ? '#' : '.')).join('')),
    numbers: puzzle.numbers,
    clues: puzzle.clues,
  }
}

/** A library puzzle is visible to everyone; an upload to its uploader and to the players of games on it. */
async function canSeePuzzle(puzzle: PuzzleData, playerId: string): Promise<boolean> {
  if (puzzle.source === 'library' || puzzle.ownerId === playerId) return true
  const { rowCount } = await pool.query('SELECT 1 FROM seats s JOIN games g ON g.id = s.game_id WHERE g.puzzle_id = $1 AND s.player_id = $2 LIMIT 1', [puzzle.id, playerId])
  return (rowCount ?? 0) > 0
}

export async function requireVisiblePuzzle(id: string, playerId: string): Promise<PuzzleData> {
  const puzzle = await loadPuzzle(id)
  if (!puzzle || !(await canSeePuzzle(puzzle, playerId))) throw new ApiError('not_found')
  return puzzle
}

export function parseFilters(query: URLSearchParams): { size: SizeFilter | null; source: SourceFilter | null } {
  const size = query.get('size')
  const source = query.get('source')
  const fields: Record<string, string> = {}
  if (size !== null && !SIZE_FILTERS.includes(size as SizeFilter)) fields.size = 'Size must be small, medium or large.'
  if (source !== null && !SOURCE_FILTERS.includes(source as SourceFilter)) fields.source = 'Source must be library or mine.'
  if (Object.keys(fields).length > 0) throw invalid(fields)
  return { size: size as SizeFilter | null, source: source as SourceFilter | null }
}

export async function listPuzzles(playerId: string, filters: { size: SizeFilter | null; source: SourceFilter | null }, inProgress: (puzzleId: string) => number): Promise<PuzzleListEntry[]> {
  const { rows } = await pool.query<PuzzleRow>(
    `SELECT * FROM puzzles WHERE source = 'library' OR owner_id = $1
     ORDER BY (source = 'library') DESC, CASE WHEN source = 'library' THEN ordinal END ASC, created_at DESC, ordinal DESC`,
    [playerId],
  )
  return rows
    .filter((row) => !filters.source || (filters.source === 'library' ? row.source === 'library' : row.source === 'upload'))
    .filter((row) => {
      if (!filters.size) return true
      const [low, high] = SIZE_BOUNDS[filters.size]
      const side = Math.max(row.cols, row.rows)
      return side >= low && side <= high
    })
    .map((row) => ({ id: row.id, title: row.title, author: row.author, cols: row.cols, rows: row.rows, source: row.source, fixture: row.fixture, in_progress: inProgress(row.id) }))
}

const insertPuzzle = (db: Queryable, id: string, parsed: ParsedPuzzle, origin: { source: 'library' | 'upload'; fixture: string | null; sha256: string | null; ownerId: string | null }): Promise<unknown> =>
  db.query(
    `INSERT INTO puzzles (id, title, author, cols, rows, source, fixture, sha256, owner_id, solution, numbers, clues)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, parsed.title, parsed.author, parsed.cols, parsed.rows, origin.source, origin.fixture, origin.sha256, origin.ownerId, JSON.stringify(parsed.solution), JSON.stringify(parsed.numbers), JSON.stringify(parsed.clues)],
  )

export const originalKey = (puzzleId: string): string => `uploads/${puzzleId}/original.overlap.txt`

/** Validates, stores the exact bytes, reads them back and saves the puzzle parsed from what was stored. */
export async function createUpload(ownerId: string, bytes: Uint8Array): Promise<{ puzzle: PuzzleData }> {
  const first = parseOverlap(bytes, config.maxGrid)
  if ('problems' in first) throw new ApiError('invalid_puzzle', { message: first.count === 1 ? 'This puzzle has 1 problem.' : `This puzzle has ${first.count} problems.`, lines: first.problems })
  const id = randomUUID()
  await putObject(originalKey(id), bytes, 'text/plain; charset=utf-8')
  const stored = await getObject(originalKey(id))
  const parsed = parseOverlap(stored, config.maxGrid)
  if ('problems' in parsed) throw new ApiError('storage_unavailable')
  await insertPuzzle(pool, id, parsed.puzzle, { source: 'upload', fixture: null, sha256: createHash('sha256').update(stored).digest('hex'), ownerId })
  const puzzle = await loadPuzzle(id)
  if (!puzzle) throw new ApiError('storage_unavailable')
  return { puzzle }
}

/** Creates the library puzzles that are missing, in library order. */
export async function seedLibrary(): Promise<void> {
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(4173002)')
    for (const entry of LIBRARY) {
      const parsed = parseOverlap(new TextEncoder().encode(entry.text), config.maxGrid)
      if ('problems' in parsed) throw new Error(`library puzzle ${entry.fixture} is invalid: ${parsed.problems.join('; ')}`)
      const exists = await client.query('SELECT 1 FROM puzzles WHERE fixture = $1', [entry.fixture])
      if ((exists.rowCount ?? 0) === 0) await insertPuzzle(client, randomUUID(), parsed.puzzle, { source: 'library', fixture: entry.fixture, sha256: null, ownerId: null })
    }
  })
}

export async function fixturePuzzle(fixture: string): Promise<PuzzleData | null> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM puzzles WHERE fixture = $1', [fixture])
  return rows.length === 0 ? null : loadPuzzle(rows[0].id)
}
