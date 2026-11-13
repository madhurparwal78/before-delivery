import { randomUUID } from 'node:crypto'
import type { Colour, Settings, Square, SquareState, Team } from '../shared/types.ts'
import { COLOURS } from '../shared/types.ts'
import { isDisplayName, isEntry } from '../shared/limits.ts'
import { pool, transaction } from './db.ts'
import { saveSquares } from './engine.ts'
import { ApiError, invalid } from './errors.ts'
import { addSeat, insertGame } from './games.ts'
import { watchIdle } from './hub.ts'
import { type PuzzleData, UUID, createUpload, fixturePuzzle } from './puzzles.ts'
import { Grid } from './rules.ts'

const SEEDED_STATES: SquareState[] = ['filled', 'pencil', 'wrong', 'right', 'revealed']
const SETTING_KEYS = ['skip_filled', 'jump_next_clue', 'autocheck'] as const

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

function records(value: unknown, field: string): Json[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(isRecord)) throw invalid({ [field]: 'Must be a list of objects.' })
  return value
}

function text(item: Json, field: string): string {
  const value = item[field]
  if (typeof value !== 'string' || value === '') throw invalid({ [field]: 'Required.' })
  return value
}

function settingsOf(item: Json): Settings | null {
  const raw = item.settings
  if (raw === undefined) return null
  if (!isRecord(raw)) throw invalid({ settings: 'Give all three settings.' })
  const [skip, jump, auto] = SETTING_KEYS.map((key) => raw[key])
  if (typeof skip !== 'boolean' || typeof jump !== 'boolean' || typeof auto !== 'boolean') throw invalid({ settings: 'Give all three settings.' })
  return { skip_filled: skip, jump_next_clue: jump, autocheck: auto }
}

interface SeedSquare {
  square: Square
  team: Team | null
}

function seedSquares(raw: unknown, puzzle: PuzzleData, colours: ReadonlyMap<string, Colour>): SeedSquare[] {
  const grid = new Grid(puzzle, [])
  return records(raw, 'squares').map((item) => {
    const { row, col, value, pencil, state, owner, team } = item
    const colour = typeof owner === 'string' ? colours.get(owner) : undefined
    const known = SEEDED_STATES.find((candidate) => candidate === state)
    if (typeof row !== 'number' || typeof col !== 'number' || !grid.squareAt(row, col)) throw invalid({ squares: 'Squares must be white squares of the puzzle.' })
    if (typeof value !== 'string' || !isEntry(value) || typeof pencil !== 'boolean' || known === undefined) throw invalid({ squares: 'Squares need a value, a pencil flag and a state.' })
    if (colour === undefined) throw invalid({ squares: 'Square owners must be players of the game.' })
    return { square: { row, col, value: value.toUpperCase(), pencil, state: known, owner: colour }, team: team === 1 || team === 2 ? team : null }
  })
}

type SeededPlayer = { id: string; display_name: string }

async function seedPlayers(raw: unknown): Promise<Map<string, SeededPlayer>> {
  const players = new Map<string, SeededPlayer>()
  for (const item of records(raw, 'players')) {
    const name = text(item, 'display_name').trim()
    if (!isDisplayName(name)) throw invalid({ display_name: 'Enter a name between 1 and 24 characters.' })
    const settings = settingsOf(item)
    const id = randomUUID()
    await pool.query('INSERT INTO players (id, display_name, skip_filled, jump_next_clue, autocheck) VALUES ($1, $2, COALESCE($3, true), COALESCE($4, false), COALESCE($5, false))', [id, name, settings?.skip_filled ?? null, settings?.jump_next_clue ?? null, settings?.autocheck ?? null])
    players.set(text(item, 'key'), { id, display_name: name })
  }
  return players
}

async function seedPuzzles(raw: unknown, players: ReadonlyMap<string, SeededPlayer>): Promise<Map<string, PuzzleData>> {
  const puzzles = new Map<string, PuzzleData>()
  for (const item of records(raw, 'puzzles')) {
    if (typeof item.fixture === 'string') {
      const puzzle = await fixturePuzzle(item.fixture)
      if (!puzzle) throw invalid({ fixture: 'Unknown fixture.' })
      puzzles.set(text(item, 'key'), puzzle)
      continue
    }
    const owner = players.get(text(item, 'owner'))
    if (!owner) throw invalid({ owner: 'Unknown player key.' })
    puzzles.set(text(item, 'key'), (await createUpload(owner.id, Buffer.from(text(item, 'text'), 'utf8'))).puzzle)
  }
  return puzzles
}

interface SeedGame {
  item: Json
  puzzle: PuzzleData
  host: SeededPlayer
  keys: string[]
}

function readGame(item: Json, puzzles: ReadonlyMap<string, PuzzleData>, players: ReadonlyMap<string, SeededPlayer>): SeedGame {
  const puzzle = puzzles.get(text(item, 'puzzle'))
  const hostKey = text(item, 'host')
  const host = players.get(hostKey)
  const listed: unknown[] = Array.isArray(item.players) ? item.players : []
  const keys = listed.filter((key): key is string => typeof key === 'string' && players.has(key))
  if (!puzzle || !host || keys.length !== listed.length || !keys.includes(hostKey)) throw invalid({ games: 'Games need a puzzle, a host and players that include the host.' })
  return { item, puzzle, host, keys }
}

async function insertSeededGame({ item, puzzle, host, keys }: SeedGame, players: ReadonlyMap<string, SeededPlayer>): Promise<{ id: string; code: string }> {
  const race = item.mode === 'race'
  const colours = new Map(keys.map((key, index) => [key, COLOURS[index]]))
  const seeded = seedSquares(item.squares, puzzle, colours)
  const elapsed = typeof item.elapsed_ms === 'number' ? item.elapsed_ms : 0
  const running = item.timer_state === 'running'
  return transaction(async (client) => {
    const game = await insertGame(client, { puzzle, hostId: host.id, mode: race ? 'race' : 'shared' }, race ? [] : seeded.map(({ square }) => square))
    for (const key of keys) await addSeat(client, game.id, players.get(key)?.id ?? host.id)
    if (race) {
      await client.query('UPDATE games SET race_state = $2 WHERE id = $1', [game.id, item.race_state === 'racing' ? 'racing' : 'lobby'])
      for (const [key, team] of Object.entries(isRecord(item.teams) ? item.teams : {})) {
        const player = players.get(key)
        if (player && (team === 1 || team === 2)) await client.query('UPDATE seats SET team = $3 WHERE game_id = $1 AND player_id = $2', [game.id, player.id, team])
      }
      for (const { square, team } of seeded) {
        for (const gridNo of team === null ? [1, 2] : [team]) await saveSquares(client, game.id, gridNo, [square])
        if (team === null) await client.query('UPDATE seats SET score = score + 1 WHERE game_id = $1 AND colour = $2', [game.id, square.owner])
      }
    } else await saveSquares(client, game.id, 0, seeded.map(({ square }) => square))
    const now = Date.now()
    if (elapsed > 0 || running) await client.query('INSERT INTO timer_segments (game_id, idx, started_at, ended_at) VALUES ($1, 0, $2, $3)', [game.id, new Date(now - elapsed), new Date(now)])
    if (running) await client.query('INSERT INTO timer_segments (game_id, idx, started_at) VALUES ($1, 1, $2)', [game.id, new Date(now)])
    await client.query('UPDATE games SET status = $2 WHERE id = $1', [game.id, running ? 'live' : elapsed > 0 ? 'paused' : 'open'])
    return game
  })
}

export async function seedGrading(body: Json): Promise<Json> {
  const players = await seedPlayers(body.players)
  const puzzles = await seedPuzzles(body.puzzles, players)
  const games: Record<string, { id: string; code: string; url: string }> = {}
  for (const item of records(body.games, 'games')) {
    const seed = readGame(item, puzzles, players)
    const created = await insertSeededGame(seed, players)
    if (item.timer_state === 'running') watchIdle(created.id, seed.puzzle.id)
    games[text(item, 'key')] = { id: created.id, code: created.code, url: `/g/${created.code}` }
  }
  return {
    players: Object.fromEntries(players),
    puzzles: Object.fromEntries([...puzzles].map(([key, puzzle]) => [key, { id: puzzle.id }])),
    games,
  }
}

export async function startSession(body: Json): Promise<string> {
  const id = body.player_id
  if (typeof id !== 'string' || !UUID.test(id) || ((await pool.query('SELECT 1 FROM players WHERE id = $1', [id])).rowCount ?? 0) === 0) throw new ApiError('not_found')
  return id
}
