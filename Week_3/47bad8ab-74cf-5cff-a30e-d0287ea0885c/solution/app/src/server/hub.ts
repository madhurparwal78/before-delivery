import type { WebSocket } from 'ws'
import type { ServerMessage, Team, WriteMessage } from '../shared/types.ts'
import { LINK_OFF_CLOSE } from '../shared/types.ts'
import { config } from './config.ts'
import { pool } from './db.ts'
import { type Audience, type Delivery, inGameQueue, submitWrite } from './engine.ts'
import { ApiError, errorBody } from './errors.ts'
import { type GameState, type Seat, gameJson, loadGameState, seatWithAccess } from './games.ts'
import { integerOrNull } from '../shared/limits.ts'
import { overRate } from './rate.ts'
import { Grid } from './rules.ts'
import { queueRecord } from './records.ts'

interface Connection {
  socket: WebSocket
  playerId: string
  alive: boolean
  lastRateError: number
}

interface Room {
  gameId: string
  puzzleId: string
  solved: boolean
  connections: Set<Connection>
  grace: NodeJS.Timeout | null
  lastClosedAt: number
}

const rooms = new Map<string, Room>()

const reportFailure = (error: unknown): void => console.error(error)

const roomOf = (gameId: string): Room | undefined => rooms.get(gameId)

export function presentIn(gameId: string): Set<string> {
  return new Set([...(roomOf(gameId)?.connections ?? [])].map((connection) => connection.playerId))
}

export function inProgress(puzzleId: string): number {
  const players = new Set<string>()
  for (const room of rooms.values()) {
    if (room.puzzleId === puzzleId && !room.solved) for (const connection of room.connections) players.add(connection.playerId)
  }
  return players.size
}

const transmit = (connection: Connection, message: ServerMessage): void => {
  if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(JSON.stringify(message))
}

async function audienceFilter(gameId: string, to: Audience): Promise<(playerId: string) => boolean> {
  if (to === 'all') return () => true
  const { rows } = await pool.query<{ player_id: string }>('SELECT player_id FROM seats WHERE game_id = $1 AND team = $2', [gameId, to.team])
  const members = new Set(rows.map((row) => row.player_id))
  return (playerId) => members.has(playerId)
}

export async function publish(gameId: string, deliveries: readonly Delivery[]): Promise<void> {
  const room = roomOf(gameId)
  if (!room) return
  for (const { message, to } of deliveries) {
    const accepts = await audienceFilter(gameId, to)
    for (const connection of room.connections) if (accepts(connection.playerId)) transmit(connection, message)
    if (message.type === 'solved' || (message.type === 'race' && message.state === 'finished')) room.solved = true
  }
}

/** The lifetime of a timer segment: a game goes live on its first connection and pauses once nobody returns within the grace. */
function goLive(game: GameState, now: Date): Promise<unknown> {
  return pool
    .query('INSERT INTO timer_segments (game_id, idx, started_at) VALUES ($1, $2, $3)', [game.id, game.segments.length, now])
    .then(() => pool.query("UPDATE games SET status = 'live' WHERE id = $1", [game.id]))
}

async function pauseIfIdle(gameId: string): Promise<void> {
  await inGameQueue(gameId, async () => {
    const room = roomOf(gameId)
    if (room && room.connections.size > 0) return
    const game = await loadGameState(pool, gameId)
    if (!game || game.status !== 'live') return
    const endedAt = new Date(room?.lastClosedAt ?? Date.now())
    await pool.query('UPDATE timer_segments SET ended_at = $2 WHERE game_id = $1 AND ended_at IS NULL', [gameId, endedAt])
    await pool.query("UPDATE games SET status = 'paused' WHERE id = $1", [gameId])
    rooms.delete(gameId)
  })
}

/** Starts the grace countdown for a live game nobody is connected to. */
export function watchIdle(gameId: string, puzzleId: string): void {
  const room = roomOf(gameId) ?? { gameId, puzzleId, solved: false, connections: new Set<Connection>(), grace: null, lastClosedAt: Date.now() }
  rooms.set(gameId, room)
  room.lastClosedAt = Date.now()
  if (room.grace) clearTimeout(room.grace)
  room.grace = setTimeout(() => void pauseIfIdle(gameId).catch(reportFailure), config.presenceGraceMs)
}

export async function recoverLiveGames(): Promise<void> {
  const { rows } = await pool.query<{ id: string; puzzle_id: string }>("SELECT id, puzzle_id FROM games WHERE status = 'live'")
  for (const row of rows) watchIdle(row.id, row.puzzle_id)
}

export async function connect(socket: WebSocket, game: GameState, seat: Seat): Promise<void> {
  const connection: Connection = { socket, playerId: seat.playerId, alive: true, lastRateError: 0 }
  socket.on('error', () => undefined)
  socket.on('pong', () => void (connection.alive = true))
  socket.on('message', (data) => void onMessage(game.id, connection, data.toString()))
  socket.on('close', () => void inGameQueue(game.id, () => onClose(game.id, connection)).catch(reportFailure))
  await inGameQueue(game.id, async () => {
    const fresh = await loadGameState(pool, game.id)
    if (!fresh) return
    const room = roomOf(game.id) ?? { gameId: game.id, puzzleId: fresh.puzzle.id, solved: false, connections: new Set<Connection>(), grace: null, lastClosedAt: 0 }
    rooms.set(game.id, room)
    room.solved = fresh.status === 'solved'
    if (room.grace) clearTimeout(room.grace)
    room.grace = null
    const firstOfPlayer = ![...room.connections].some((other) => other.playerId === seat.playerId)
    room.connections.add(connection)
    const wentLive = fresh.status === 'open' || fresh.status === 'paused'
    const state = wentLive ? ((await goLive(fresh, new Date())), await loadGameState(pool, game.id)) : fresh
    if (!state) return
    const you = seatWithAccess(state, seat.playerId) ?? seat
    transmit(connection, { type: 'hello', you: seat.playerId, game: await gameJson(pool, state, you, presentIn(game.id)) })
    if (firstOfPlayer) {
      for (const other of room.connections) if (other.playerId !== seat.playerId) transmit(other, { type: 'presence', player_id: seat.playerId, display_name: you.displayName, colour: you.colour, present: true })
    }
    if (wentLive) {
      const hello = await gameJson(pool, state, you, presentIn(game.id))
      for (const other of room.connections) if (other !== connection) transmit(other, { type: 'timer', state: 'running', elapsed_ms: hello.elapsed_ms })
    }
  })
}

async function onClose(gameId: string, connection: Connection): Promise<void> {
  const room = roomOf(gameId)
  if (!room || !room.connections.delete(connection)) return
  const stillHere = [...room.connections].some((other) => other.playerId === connection.playerId)
  const state = await loadGameState(pool, gameId)
  const seat = state?.seats.find((candidate) => candidate.playerId === connection.playerId)
  if (!stillHere && seat) {
    for (const other of room.connections) transmit(other, { type: 'presence', player_id: seat.playerId, display_name: seat.displayName, colour: seat.colour, present: false })
  }
  if (room.connections.size === 0 && state) watchIdle(gameId, state.puzzle.id)
}

function sendError(connection: Connection, error: ApiError, clientOpId: string | null): void {
  const { error: code, message } = errorBody(error)
  transmit(connection, { type: 'error', code, message, client_op_id: clientOpId })
}

/** Applies a write and publishes its result in the game's queue; the sender alone gets a replayed result. */
export async function applyWrite(gameId: string, playerId: string, input: unknown, replayTo?: Connection): Promise<WriteMessage> {
  const outcome = await submitWrite(gameId, playerId, input, async (committed) => {
    const sender = replayTo && committed.deliveries.length === 0 ? replayTo : null
    if (sender) transmit(sender, committed.response)
    else await publish(gameId, committed.deliveries)
  })
  if (outcome.solved) queueRecord(gameId)
  return outcome.response
}

async function onMessage(gameId: string, connection: Connection, text: string): Promise<void> {
  const message = parseFrame(text)
  if (message === null) return
  const clientOpId = typeof message.client_op_id === 'string' ? message.client_op_id : null
  if (overRate(connection.playerId)) {
    const now = Date.now()
    if (now - connection.lastRateError >= 1000) {
      connection.lastRateError = now
      sendError(connection, new ApiError('rate_limited'), clientOpId)
    }
    return
  }
  if (message.type === 'cursor') return relayCursor(gameId, connection, message)
  try {
    await applyWrite(gameId, connection.playerId, message, connection)
  } catch (error) {
    if (error instanceof ApiError) sendError(connection, error, clientOpId)
    else console.error(error)
  }
}

function parseFrame(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function relayCursor(gameId: string, connection: Connection, message: Record<string, unknown>): Promise<void> {
  const { row, col, direction } = message
  const game = await loadGameState(pool, gameId)
  const seat = game && seatWithAccess(game, connection.playerId)
  if (!game || !seat || (game.mode === 'race' && seat.team === null)) return
  const square = new Grid(game.puzzle, []).squareAt(integerOrNull(row), integerOrNull(col))
  if (!square || (direction !== 'across' && direction !== 'down')) return
  const cursor: ServerMessage = { type: 'cursor', player_id: seat.playerId, colour: seat.colour, row: square.row, col: square.col, direction }
  const accepts = await audienceFilter(gameId, game.mode === 'race' && seat.team !== null ? { team: seat.team } : 'all')
  for (const other of roomOf(gameId)?.connections ?? []) if (other !== connection && accepts(other.playerId)) transmit(other, cursor)
}

/** Every other player's open connections get the `link_off` message and are closed; the host keeps theirs. */
export function revokeLink(gameId: string, hostId: string, reason: 'off' | 'replaced'): void {
  const message = new ApiError(reason === 'off' ? 'link_off' : 'link_replaced').message
  for (const connection of roomOf(gameId)?.connections ?? []) {
    if (connection.playerId === hostId) continue
    transmit(connection, { type: 'link_off', reason, message })
    connection.socket.close(LINK_OFF_CLOSE)
  }
}

export async function teamChanged(gameId: string, playerId: string, team: Team | null): Promise<void> {
  await publish(gameId, [{ message: { type: 'team', player_id: playerId, team }, to: 'all' }])
}

export function startHeartbeat(): void {
  setInterval(() => {
    for (const room of rooms.values()) {
      for (const connection of room.connections) {
        if (!connection.alive) {
          connection.socket.terminate()
          continue
        }
        connection.alive = false
        connection.socket.ping()
      }
    }
  }, config.heartbeatMs).unref()
}
