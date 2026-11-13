import { randomInt, randomUUID } from 'node:crypto'
import type { Colour, GameJson, GameMode, GameStatus, HistoryStats, PlayerJson, PlayerStats, RaceState, Scores, Square, Team } from '../shared/types.ts'
import { COLOURS } from '../shared/types.ts'
import { config } from './config.ts'
import { type Queryable, pool, transaction } from './db.ts'
import { ApiError, invalid } from './errors.ts'
import { type PuzzleData, UUID, loadPuzzle, requireVisiblePuzzle } from './puzzles.ts'
import { Grid } from './rules.ts'
import { type Segment, elapsedMs, segmentJson, timerState } from './timer.ts'


export interface Seat {
  playerId: string
  displayName: string
  seat: number
  colour: Colour
  team: Team | null
  score: number
  hasAccess: boolean
}

export interface GameState {
  id: string
  puzzle: PuzzleData
  hostId: string
  mode: GameMode
  raceState: RaceState | null
  status: GameStatus
  seq: number
  checkedCount: number
  solvedAt: Date | null
  initial: Square[]
  recordWritten: boolean
  code: string | null
  linkState: 'active' | 'off'
  seats: Seat[]
  segments: Segment[]
}

interface GameRow {
  id: string
  puzzle_id: string
  host_id: string
  mode: GameMode
  race_state: RaceState | null
  status: GameStatus
  seq: number
  checked_count: number
  solved_at: Date | null
  initial: Square[]
  record_written: boolean
}

export async function loadGameState(db: Queryable, id: string, lock = false): Promise<GameState | null> {
  if (!UUID.test(id)) return null
  const game = await db.query<GameRow>(`SELECT * FROM games WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  if (game.rows.length === 0) return null
  const row = game.rows[0]
  const puzzle = await loadPuzzle(row.puzzle_id, db)
  const seats = await db.query<{ player_id: string; display_name: string; seat: number; colour: Colour; team: Team | null; score: number; has_access: boolean }>(
    'SELECT s.*, p.display_name FROM seats s JOIN players p ON p.id = s.player_id WHERE s.game_id = $1 ORDER BY s.seat',
    [id],
  )
  const codes = await db.query<{ code: string }>("SELECT code FROM link_codes WHERE game_id = $1 AND state = 'active'", [id])
  const segments = await db.query<{ started_at: Date; ended_at: Date | null }>('SELECT started_at, ended_at FROM timer_segments WHERE game_id = $1 ORDER BY idx', [id])
  if (!puzzle) return null
  return {
    id: row.id,
    puzzle,
    hostId: row.host_id,
    mode: row.mode,
    raceState: row.race_state,
    status: row.status,
    seq: row.seq,
    checkedCount: row.checked_count,
    solvedAt: row.solved_at,
    initial: row.initial,
    recordWritten: row.record_written,
    code: codes.rows[0]?.code ?? null,
    linkState: codes.rows.length > 0 ? 'active' : 'off',
    seats: seats.rows.map((seat) => ({ playerId: seat.player_id, displayName: seat.display_name, seat: seat.seat, colour: seat.colour, team: seat.team, score: seat.score, hasAccess: seat.has_access })),
    segments: segments.rows.map((segment) => ({ startedAt: segment.started_at, endedAt: segment.ended_at })),
  }
}

/** The one link access check: the host always has access, other players while they joined through the current code. */
export function seatWithAccess(game: GameState, playerId: string): Seat | undefined {
  return game.seats.find((seat) => seat.playerId === playerId && seat.hasAccess)
}

export async function requireGame(id: string, playerId: string, db: Queryable = pool, lock = false): Promise<{ game: GameState; seat: Seat }> {
  const game = await loadGameState(db, id, lock)
  const seat = game && seatWithAccess(game, playerId)
  if (!game || !seat) throw new ApiError('not_found')
  return { game, seat }
}

/** The grid a player works in: the shared grid, or their team's grid in a race (watchers see no grid of their own). */
export const gridNumber = (game: GameState, seat: Seat): number => (game.mode === 'shared' ? 0 : (seat.team ?? 0))

async function loadGrid(db: Queryable, gameId: string, grid: number): Promise<Square[]> {
  const { rows } = await db.query<Square>('SELECT row, col, value, pencil, state, owner FROM squares WHERE game_id = $1 AND grid = $2', [gameId, grid])
  return rows
}

export async function gridFor(db: Queryable, game: GameState, number: number): Promise<Grid> {
  return new Grid(game.puzzle, await loadGrid(db, game.id, number))
}

export function scoresOf(game: GameState): Scores {
  const total = (team: Team): number => game.seats.filter((seat) => seat.team === team).reduce((sum, seat) => sum + seat.score, 0)
  return { 1: total(1), 2: total(2) }
}

/** Per-player solve stats with the player's name and colour; the one shape of the solved message and the history entries. */
export function historyStats(stats: readonly PlayerStats[], game: GameState): HistoryStats[] {
  return game.seats.flatMap((seat) => {
    const mine = stats.find((entry) => entry.player_id === seat.playerId)
    return mine ? [{ display_name: seat.displayName, colour: seat.colour, letters: mine.letters, revealed: mine.revealed }] : []
  })
}

function playerJson(game: GameState, present: ReadonlySet<string>): PlayerJson[] {
  return game.seats.map((seat) => ({ id: seat.playerId, display_name: seat.displayName, colour: seat.colour, host: seat.playerId === game.hostId, present: present.has(seat.playerId), team: seat.team, score: seat.score }))
}

export async function gameJson(db: Queryable, game: GameState, seat: Seat, present: ReadonlySet<string>, now: number = Date.now()): Promise<GameJson> {
  const number = gridNumber(game, seat)
  let squares: Square[]
  if (game.mode === 'race' && seat.team === null) {
    const claimed = new Map((await loadGrid(db, game.id, 1)).filter((square) => square.state === 'right').map((square) => [`${square.row},${square.col}`, square]))
    squares = new Grid(game.puzzle, [...claimed.values()]).all()
  } else squares = new Grid(game.puzzle, await loadGrid(db, game.id, number)).all()
  return {
    id: game.id,
    puzzle_id: game.puzzle.id,
    puzzle_title: game.puzzle.title,
    host_player_id: game.hostId,
    code: game.code,
    link_state: game.linkState,
    status: game.status,
    timer_state: timerState(game.status),
    elapsed_ms: elapsedMs(game.segments, now),
    timer_segments: game.segments.map(segmentJson),
    seq: game.seq,
    revealed_count: squares.filter((square) => square.state === 'revealed').length,
    checked_count: game.checkedCount,
    solved_at: game.solvedAt?.toISOString() ?? null,
    mode: game.mode,
    race_state: game.raceState,
    scores: game.mode === 'race' ? scoresOf(game) : null,
    players: playerJson(game, present),
    squares,
  }
}

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const newCode = (): string => Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')

/** Seats a player with the first colour not yet used in the game; the seat and its colour stay for the life of the game. */
export async function addSeat(db: Queryable, gameId: string, playerId: string): Promise<void> {
  const { rows } = await db.query<{ colour: Colour }>('SELECT colour FROM seats WHERE game_id = $1', [gameId])
  const colour = COLOURS.find((candidate) => !rows.some((row) => row.colour === candidate)) ?? COLOURS[0]
  await db.query('INSERT INTO seats (game_id, player_id, seat, colour) VALUES ($1, $2, $3, $4)', [gameId, playerId, rows.length, colour])
}

interface NewGame {
  puzzle: PuzzleData
  hostId: string
  mode: GameMode
}

/** Creates the game and its link code; the caller seats the players. */
export async function insertGame(db: Queryable, { puzzle, hostId, mode }: NewGame, initial: Square[] = []): Promise<{ id: string; code: string }> {
  const id = randomUUID()
  const code = newCode()
  await db.query('INSERT INTO games (id, puzzle_id, host_id, mode, race_state, initial) VALUES ($1, $2, $3, $4, $5, $6)', [id, puzzle.id, hostId, mode, mode === 'race' ? 'lobby' : null, JSON.stringify(initial)])
  await db.query("INSERT INTO link_codes (code, game_id, state) VALUES ($1, $2, 'active')", [code, id])
  return { id, code }
}

export async function createGame(playerId: string, body: { puzzle_id?: unknown; mode?: unknown }): Promise<string> {
  const fields: Record<string, string> = {}
  if (typeof body.puzzle_id !== 'string' || body.puzzle_id === '') fields.puzzle_id = 'Choose a puzzle.'
  if (body.mode !== undefined && body.mode !== 'shared' && body.mode !== 'race') fields.mode = 'Mode must be shared or race.'
  if (Object.keys(fields).length > 0) throw invalid(fields)
  const puzzle = await requireVisiblePuzzle(String(body.puzzle_id), playerId)
  return transaction(async (client) => {
    const { id } = await insertGame(client, { puzzle, hostId: playerId, mode: body.mode === 'race' ? 'race' : 'shared' })
    await addSeat(client, id, playerId)
    return id
  })
}

/** Resolves a link code: unknown is 404, a code that was turned off or replaced is 410. */
export async function resolveCode(code: string): Promise<GameState> {
  const { rows } = await pool.query<{ game_id: string; state: 'active' | 'off' | 'replaced' }>('SELECT game_id, state FROM link_codes WHERE code = $1', [code])
  if (rows.length === 0) throw new ApiError('not_found')
  if (rows[0].state !== 'active') throw new ApiError(rows[0].state === 'off' ? 'link_off' : 'link_replaced')
  const game = await loadGameState(pool, rows[0].game_id)
  if (!game) throw new ApiError('not_found')
  return game
}

/** Joins through the current code. A player already seated always rejoins and regains access. */
export async function joinGame(code: string, playerId: string): Promise<string> {
  const game = await resolveCode(code)
  await transaction(async (client) => {
    const fresh = await loadGameState(client, game.id, true)
    if (!fresh) throw new ApiError('not_found')
    if (fresh.seats.some((seat) => seat.playerId === playerId)) {
      await client.query('UPDATE seats SET has_access = true WHERE game_id = $1 AND player_id = $2', [game.id, playerId])
      return
    }
    if (fresh.status === 'solved') throw new ApiError('game_solved')
    if (fresh.seats.length >= config.maxPlayers) throw new ApiError('game_full')
    await addSeat(client, fresh.id, playerId)
  })
  return game.id
}

function requireHost(game: GameState, playerId: string): void {
  if (game.hostId !== playerId) throw new ApiError('not_host')
}

/** Turns the link off or replaces it; every other player loses access until they join through the current code. */
export async function changeLink(gameId: string, playerId: string, change: 'off' | 'replace'): Promise<void> {
  await transaction(async (client) => {
    const { game } = await requireGame(gameId, playerId, client, true)
    requireHost(game, playerId)
    if (change === 'off' && game.linkState === 'off') throw new ApiError('link_already_off')
    await client.query("UPDATE link_codes SET state = $2 WHERE game_id = $1 AND state = 'active'", [gameId, change === 'off' ? 'off' : 'replaced'])
    if (change === 'replace') await client.query("INSERT INTO link_codes (code, game_id, state) VALUES ($1, $2, 'active')", [newCode(), gameId])
    await client.query('UPDATE seats SET has_access = false WHERE game_id = $1 AND player_id <> $2', [gameId, game.hostId])
  })
}

export async function chooseTeam(gameId: string, playerId: string, body: { team?: unknown }): Promise<Team | null> {
  return transaction(async (client) => {
    const { game } = await requireGame(gameId, playerId, client, true)
    if (game.mode === 'race' && game.raceState !== 'lobby') throw new ApiError('race_started')
    if (game.mode !== 'race' || (body.team !== 1 && body.team !== 2 && body.team !== null)) throw invalid({ team: 'Choose Team 1, Team 2 or Watch.' })
    await client.query('UPDATE seats SET team = $3 WHERE game_id = $1 AND player_id = $2', [gameId, playerId, body.team])
    return body.team
  })
}

export async function startRace(gameId: string, playerId: string): Promise<void> {
  await transaction(async (client) => {
    const { game } = await requireGame(gameId, playerId, client, true)
    requireHost(game, playerId)
    if (game.mode === 'race' && game.raceState !== 'lobby') throw new ApiError('race_started')
    if (game.mode !== 'race') throw invalid({ mode: 'Only race games can be started.' })
    if (![1, 2].every((team) => game.seats.some((seat) => seat.team === team))) throw invalid({ teams: 'Each team needs at least one player.' })
    await client.query("UPDATE games SET race_state = 'racing' WHERE id = $1", [gameId])
  })
}
