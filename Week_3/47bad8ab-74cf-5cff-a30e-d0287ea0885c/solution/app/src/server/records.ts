import type { HistoryEntry, Op, PlayerStats, SolveRecord } from '../shared/types.ts'
import { pool, transaction } from './db.ts'
import { ApiError } from './errors.ts'
import { type GameState, gridFor, historyStats, loadGameState } from './games.ts'
import { Grid } from './rules.ts'
import { getObject, objectExists, putObject } from './s3.ts'
import { elapsedMs, segmentJson } from './timer.ts'

const RETRY_MS = 5000

const recordKey = (gameId: string): string => `records/${gameId}.json`

const pending = new Set<string>()
let flushing = false

async function buildRecord(game: GameState): Promise<SolveRecord> {
  const grid = await gridFor(pool, game, 0)
  const initial = new Grid(game.puzzle, game.initial)
  const ops = await pool.query<{ op: Op }>('SELECT op FROM ops WHERE game_id = $1 ORDER BY seq', [game.id])
  const stats = await pool.query<{ stats: PlayerStats[] }>('SELECT stats FROM games WHERE id = $1', [game.id])
  const final = grid.all()
  return {
    format: 'overlap-solve-record-1',
    game_id: game.id,
    puzzle_id: game.puzzle.id,
    puzzle_title: game.puzzle.title,
    cols: game.puzzle.cols,
    rows: game.puzzle.rows,
    solved_at: (game.solvedAt ?? new Date()).toISOString(),
    elapsed_ms: elapsedMs(game.segments, Date.now()),
    revealed_count: final.filter((square) => square.state === 'revealed').length,
    checked_count: game.checkedCount,
    players: game.seats.map((seat) => ({ id: seat.playerId, display_name: seat.displayName, colour: seat.colour })),
    initial: initial.all(),
    final,
    ops: ops.rows.map((row) => row.op),
    timer_segments: game.segments.map(segmentJson),
    stats: stats.rows[0].stats,
  }
}

/** Writes the solve record once. A row lock keeps two processes from writing the same record; a locked row stays pending for the next flush. */
async function writeRecord(gameId: string): Promise<void> {
  const settled = await transaction(async (client) => {
    const row = await client.query<{ record_written: boolean }>('SELECT record_written FROM games WHERE id = $1 FOR UPDATE SKIP LOCKED', [gameId])
    if (row.rows.length === 0) return (await client.query('SELECT 1 FROM games WHERE id = $1', [gameId])).rowCount === 0
    if (row.rows[0].record_written) return true
    const game = await loadGameState(client, gameId)
    if (!game) return true
    if (!(await objectExists(recordKey(gameId)))) await putObject(recordKey(gameId), Buffer.from(JSON.stringify(await buildRecord(game))), 'application/json')
    await client.query('UPDATE games SET record_written = true WHERE id = $1', [gameId])
    return true
  })
  if (settled) pending.delete(gameId)
  else setTimeout(() => void flushRecords(), 250).unref()
}

export async function flushRecords(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    for (const gameId of [...pending]) {
      try {
        await writeRecord(gameId)
      } catch (error) {
        if (!(error instanceof ApiError)) console.error(error)
      }
    }
  } finally {
    flushing = false
  }
}

export function queueRecord(gameId: string): void {
  pending.add(gameId)
  void flushRecords()
}

/** Games solved before this process started whose record was never written. */
export async function recoverRecords(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM games WHERE status = 'solved' AND mode = 'shared' AND NOT record_written")
  for (const row of rows) pending.add(row.id)
  await flushRecords()
}

export function startRecordRetries(): void {
  setInterval(() => void flushRecords(), RETRY_MS).unref()
}

interface HistoryRow {
  game_id: string
  puzzle_id: string
  stats: PlayerStats[]
  record_written: boolean
}

export async function historyEntries(playerId: string): Promise<HistoryEntry[]> {
  const { rows } = await pool.query<HistoryRow>(
    `SELECT g.id AS game_id, g.puzzle_id, g.stats, g.record_written
     FROM history_entries h JOIN games g ON g.id = h.game_id
     WHERE h.player_id = $1 ORDER BY g.solved_at DESC, g.created_at DESC`,
    [playerId],
  )
  const entries: HistoryEntry[] = []
  for (const row of rows) {
    const game = await loadGameState(pool, row.game_id)
    if (!game?.solvedAt) continue
    const squares = (await gridFor(pool, game, 0)).all()
    entries.push({
      game_id: game.id,
      puzzle_id: game.puzzle.id,
      puzzle_title: game.puzzle.title,
      cols: game.puzzle.cols,
      rows: game.puzzle.rows,
      elapsed_ms: elapsedMs(game.segments, Date.now()),
      solved_at: game.solvedAt.toISOString(),
      revealed_count: squares.filter((square) => square.state === 'revealed').length,
      checked_count: game.checkedCount,
      record_ready: row.record_written,
      players: game.seats.map((seat) => ({ display_name: seat.displayName, colour: seat.colour })),
      squares: squares.map((square) => ({ row: square.row, col: square.col, owner: square.owner })),
      stats: historyStats(row.stats, game),
    })
  }
  return entries
}

export async function readRecord(playerId: string, gameId: string): Promise<Buffer> {
  const { rows } = await pool.query<{ record_written: boolean }>('SELECT g.record_written FROM history_entries h JOIN games g ON g.id = h.game_id WHERE h.player_id = $1 AND h.game_id = $2', [playerId, gameId])
  if (rows.length === 0) throw new ApiError('not_found')
  if (!rows[0].record_written) throw new ApiError('storage_unavailable')
  return getObject(recordKey(gameId))
}
