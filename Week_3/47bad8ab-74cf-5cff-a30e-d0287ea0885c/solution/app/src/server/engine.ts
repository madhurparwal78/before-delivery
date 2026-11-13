import type pg from 'pg'
import type { CellOp, CheckOp, ClaimOp, ClearOp, Op, RevealOp, ServerMessage, Square, Team, WriteMessage } from '../shared/types.ts'
import type { Direction } from '../shared/numbering.ts'
import { CLIENT_OP_ID_MAX, integerOrNull, isEntry } from '../shared/limits.ts'
import { transaction } from './db.ts'
import { ApiError, invalid } from './errors.ts'
import { type GameState, type Seat, gridFor, gridNumber, historyStats, requireGame, scoresOf } from './games.ts'
import { isLocked } from '../shared/squares.ts'
import { type Grid, checkSquares, claimSquare, clearSquares, revealSquares, solveStats, writeSquare } from './rules.ts'
import { elapsedMs } from './timer.ts'

export type Audience = 'all' | { team: Team }

export interface Delivery {
  message: ServerMessage
  to: Audience
}

interface WriteOutcome {
  response: WriteMessage
  deliveries: Delivery[]
  solved: boolean
}

interface Write {
  type: unknown
  row: number | null
  col: number | null
  value: unknown
  pencil: unknown
  scope: unknown
  direction: Direction | null
  clientOpId: string | null
  clientOpIdValid: boolean
}

function readWrite(input: unknown): Write {
  const raw: Record<string, unknown> = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const id = raw.client_op_id
  const validId = typeof id === 'string' && id.length >= 1 && id.length <= CLIENT_OP_ID_MAX
  return {
    type: raw.type,
    row: integerOrNull(raw.row),
    col: integerOrNull(raw.col),
    value: raw.value,
    pencil: raw.pencil,
    scope: raw.scope,
    direction: raw.direction === 'across' || raw.direction === 'down' ? raw.direction : null,
    clientOpId: validId ? id : null,
    clientOpIdValid: validId || id === undefined || id === null,
  }
}

const fingerprint = (write: Write): string => JSON.stringify([write.type, write.row, write.col, write.value ?? null, write.pencil ?? null, write.scope ?? null, write.direction])

const queues = new Map<string, Promise<unknown>>()

/** Writes for one game are applied one at a time, in arrival order. */
export function inGameQueue<T>(gameId: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(gameId) ?? Promise.resolve()).then(work, work)
  const tail = run.catch(() => undefined)
  queues.set(gameId, tail)
  void tail.then(() => {
    if (queues.get(gameId) === tail) queues.delete(gameId)
  })
  return run
}

/** The team a writer plays for in a race, null in a shared game; a race player on no team only watches. */
function racerTeam(game: GameState, seat: Seat): Team | null {
  if (game.mode === 'shared') return null
  if (seat.team === null) throw new ApiError('watching')
  return seat.team
}

export async function saveSquares(client: pg.PoolClient, gameId: string, gridNo: number, squares: readonly Square[]): Promise<void> {
  for (const square of squares) {
    await client.query(
      `INSERT INTO squares (game_id, grid, row, col, value, pencil, state, owner) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (game_id, grid, row, col) DO UPDATE SET value = $5, pencil = $6, state = $7, owner = $8`,
      [gameId, gridNo, square.row, square.col, square.value, square.pencil, square.state, square.owner],
    )
  }
}

interface Applied {
  op: Op
  message: WriteMessage
  to: Audience
}

/**
 * Applies one write to the stored game, then hands its deliveries to `deliver` inside the same queue slot, so clients
 * see writes in sequence order. Conflicts are decided before validation, as the error precedence says.
 */
export async function submitWrite(gameId: string, playerId: string, input: unknown, deliver: (outcome: WriteOutcome) => Promise<void>): Promise<WriteOutcome> {
  const write = readWrite(input)
  return inGameQueue(gameId, async () => {
    const outcome = await transaction(async (client): Promise<WriteOutcome> => {
      const { game, seat } = await requireGame(gameId, playerId, client, true)
      const team = racerTeam(game, seat)
      if (write.clientOpId !== null) {
        const stored = await client.query<{ fingerprint: string; message: WriteMessage }>('SELECT fingerprint, message FROM ops WHERE game_id = $1 AND player_id = $2 AND client_op_id = $3', [gameId, playerId, write.clientOpId])
        if (stored.rows.length > 0) {
          if (stored.rows[0].fingerprint !== fingerprint(write)) throw new ApiError('op_id_reused')
          return { response: stored.rows[0].message, deliveries: [], solved: false }
        }
      }
      if (game.status === 'solved') throw new ApiError('game_solved')
      if (team !== null && game.raceState !== 'racing') throw new ApiError('race_not_started')
      const grid = await gridFor(client, game, gridNumber(game, seat))
      const target = grid.squareAt(write.row, write.col)
      const locksSquare = write.type === 'cell' || (write.type === 'check' && team !== null && write.scope === 'square')
      if (locksSquare && target && isLocked(grid.get(target.row, target.col))) throw new ApiError('square_locked')
      if (!write.clientOpIdValid) throw invalid({ client_op_id: `Operation ids are 1 to ${CLIENT_OP_ID_MAX} characters.` })

      const player = await client.query<{ autocheck: boolean }>('SELECT autocheck FROM players WHERE id = $1', [playerId])
      const seq = game.seq + 1
      const applied = await apply({ client, game, seat, team, grid, write, seq, at: new Date().toISOString(), autocheck: player.rows[0].autocheck })
      await client.query('INSERT INTO ops (game_id, seq, player_id, client_op_id, fingerprint, op, message) VALUES ($1, $2, $3, $4, $5, $6, $7)', [gameId, seq, playerId, write.clientOpId, fingerprint(write), JSON.stringify(applied.op), JSON.stringify(applied.message)])
      await client.query('UPDATE games SET seq = $2 WHERE id = $1', [gameId, seq])
      const deliveries: Delivery[] = [{ message: applied.message, to: applied.to }]
      const solved = await conclude(client, game, grid, applied, deliveries)
      return { response: applied.message, deliveries, solved }
    })
    await deliver(outcome)
    return outcome
  })
}

interface ApplyInput {
  client: pg.PoolClient
  game: GameState
  seat: Seat
  team: Team | null
  grid: Grid
  write: Write
  seq: number
  at: string
  autocheck: boolean
}

const withTeam = <T extends object>(team: Team | null, value: T): T => (team === null ? value : { ...value, team })

async function apply({ client, game, seat, team, grid, write, seq, at, autocheck }: ApplyInput): Promise<Applied> {
  const base = { seq, by: seat.playerId, at, client_op_id: write.clientOpId }
  const to: Audience = team === null ? 'all' : { team }
  const gridNo = gridNumber(game, seat)
  if (write.type === 'cell') {
    const spot = grid.squareAt(write.row, write.col)
    const { value, pencil } = write
    if (!spot || typeof value !== 'string' || (value !== '' && !isEntry(value)) || typeof pencil !== 'boolean') throw invalid({ cell: 'Write a letter or digits to a white square.' })
    const { square, autocheck: checked } = writeSquare(grid, { colour: seat.colour, autocheck: autocheck && team === null }, spot.row, spot.col, value, pencil)
    await saveSquares(client, game.id, gridNo, [square])
    const op: CellOp = withTeam(team, { ...base, type: 'cell', row: square.row, col: square.col, value: square.value, pencil: square.pencil, state: square.state, autocheck: checked })
    const message = withTeam(team, { type: 'cell' as const, seq, row: square.row, col: square.col, value: square.value, pencil: square.pencil, state: square.state, owner: square.owner, by: seat.playerId, client_op_id: write.clientOpId, autocheck: checked })
    return { op, message, to }
  }
  if (write.type !== 'check' && write.type !== 'reveal' && write.type !== 'clear') throw invalid({ type: 'Unknown write type.' })
  const target = grid.target(write.scope, write.row, write.col, write.direction)
  if (!target) throw invalid({ scope: 'Choose square, word or puzzle, with a white square and a direction for a word.' })
  const where = { scope: target.scope, row: target.scope === 'puzzle' ? null : target.row, col: target.scope === 'puzzle' ? null : target.col, direction: target.scope === 'word' ? target.direction : null }

  if (write.type === 'clear') {
    if (target.scope === 'square' || (team !== null && target.scope === 'puzzle')) throw invalid({ scope: team === null ? 'Clear a word or the puzzle.' : 'Clear a word.' })
    const cleared = clearSquares(grid, target)
    await saveSquares(client, game.id, gridNo, grid.changedSquares())
    const op: ClearOp = withTeam(team, { ...base, type: 'clear', ...where, squares: cleared })
    const message = withTeam(team, { type: 'clear' as const, seq, scope: target.scope, by: seat.playerId, cleared: cleared.length, squares: cleared.map(({ row, col }) => ({ row, col })), client_op_id: write.clientOpId })
    return { op, message, to }
  }

  if (team !== null && (target.scope !== 'square' || write.type === 'reveal')) throw invalid({ scope: 'Only a square can be checked in a race.' })
  if (write.type === 'reveal') {
    const revealed = revealSquares(grid, grid.squaresOf(target), seat.colour)
    await saveSquares(client, game.id, gridNo, grid.changedSquares())
    const op: RevealOp = { ...base, type: 'reveal', ...where, squares: revealed }
    return { op, message: { type: 'reveal', seq, scope: target.scope, by: seat.playerId, revealed: revealed.length, squares: revealed, client_op_id: write.clientOpId }, to: 'all' }
  }

  if (team !== null && target.scope === 'square') return raceCheck({ client, game, seat, team, grid, base, row: target.row, col: target.col })
  const { marks, wrong } = checkSquares(grid, grid.squaresOf(target))
  await saveSquares(client, game.id, gridNo, grid.changedSquares())
  await client.query('UPDATE games SET checked_count = checked_count + 1 WHERE id = $1', [game.id])
  const op: CheckOp = { ...base, type: 'check', ...where, squares: marks }
  return { op, message: { type: 'check', seq, scope: target.scope, by: seat.playerId, wrong, squares: marks, client_op_id: write.clientOpId }, to: 'all' }
}

interface RaceCheck {
  client: pg.PoolClient
  game: GameState
  seat: Seat
  team: Team
  grid: Grid
  base: { seq: number; by: string; at: string; client_op_id: string | null }
  row: number
  col: number
}

/** A right check claims the square for the whole race; a wrong check marks it in the checker's team grid only. */
async function raceCheck({ client, game, seat, team, grid, base, row, col }: RaceCheck): Promise<Applied> {
  const square = grid.get(row, col)
  if (square.value === '') throw invalid({ row: 'Check a filled square.' })
  const where = { scope: 'square' as const, row, col, direction: null }
  if (square.value !== grid.answer(row, col)) {
    const { marks, wrong } = checkSquares(grid, [square])
    await saveSquares(client, game.id, team, grid.changedSquares())
    await client.query('UPDATE games SET checked_count = checked_count + 1 WHERE id = $1', [game.id])
    const op: CheckOp = { ...base, type: 'check', ...where, squares: marks, team }
    return { op, message: { type: 'check', seq: base.seq, scope: 'square', by: seat.playerId, wrong, squares: marks, client_op_id: base.client_op_id }, to: { team } }
  }
  const claimed = claimSquare(grid, square, seat.colour)
  const rival: Team = team === 1 ? 2 : 1
  const other = await gridFor(client, game, rival)
  claimSquare(other, other.get(row, col), seat.colour)
  await saveSquares(client, game.id, team, grid.changedSquares())
  await saveSquares(client, game.id, rival, other.changedSquares())
  await client.query('UPDATE seats SET score = score + 1 WHERE game_id = $1 AND player_id = $2', [game.id, seat.playerId])
  const scores = scoresOf({ ...game, seats: game.seats.map((entry) => (entry.playerId === seat.playerId ? { ...entry, score: entry.score + 1 } : entry)) })
  const op: ClaimOp = { ...base, type: 'claim', row, col, team, squares: [claimed] }
  return { op, message: { type: 'claim', seq: base.seq, row, col, value: claimed.value, owner: seat.colour, team, by: seat.playerId, scores, client_op_id: base.client_op_id }, to: 'all' }
}

/** Decides whether the write finished the game; records the solve exactly once, in the write's own transaction. */
async function conclude(client: pg.PoolClient, game: GameState, grid: Grid, applied: Applied, out: Delivery[]): Promise<boolean> {
  const claim = applied.message.type === 'claim' ? applied.message : null
  const raceFinished = claim !== null && grid.all().every((square) => square.state === 'right')
  const solved = game.mode === 'shared' && (applied.op.type === 'cell' || applied.op.type === 'reveal') && grid.isSolved()
  if (!raceFinished && !solved) return false
  const finishedAt = new Date()
  await client.query("UPDATE games SET status = 'solved', solved_at = $2 WHERE id = $1", [game.id, finishedAt])
  await client.query('UPDATE timer_segments SET ended_at = $2 WHERE game_id = $1 AND ended_at IS NULL', [game.id, finishedAt])
  const elapsed = elapsedMs(game.segments.map((segment) => (segment.endedAt ? segment : { ...segment, endedAt: finishedAt })), finishedAt.getTime())
  const frozen: Delivery = { message: { type: 'timer', state: 'solved', elapsed_ms: elapsed }, to: 'all' }
  if (claim) {
    await client.query("UPDATE games SET race_state = 'finished' WHERE id = $1", [game.id])
    out.push({ message: { type: 'race', state: 'finished', scores: claim.scores }, to: 'all' }, frozen)
    return true
  }
  const finalSquares = grid.all()
  const stats = solveStats(finalSquares, game.seats.map((seat) => ({ id: seat.playerId, colour: seat.colour })))
  await client.query('UPDATE games SET stats = $2 WHERE id = $1', [game.id, JSON.stringify(stats)])
  await client.query('INSERT INTO history_entries (game_id, player_id) SELECT game_id, player_id FROM seats WHERE game_id = $1', [game.id])
  const revealed = finalSquares.filter((square) => square.state === 'revealed').length
  out.push({ message: { type: 'solved', seq: applied.op.seq, elapsed_ms: elapsed, revealed_count: revealed, stats: historyStats(stats, game) }, to: 'all' }, frozen)
  return true
}
