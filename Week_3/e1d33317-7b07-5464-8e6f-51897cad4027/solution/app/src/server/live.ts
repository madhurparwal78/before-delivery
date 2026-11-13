// The live session: WebSocket upgrade, heartbeats, pings and everything released when a socket ends.

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientHeartbeat, PresenceCursor } from '../shared/protocol.js'
import { seatFor } from './auth.js'
import { query } from './db.js'
import { toResponse, ApiError } from './errors.js'
import { addConnection, allConnections, dropConnection, dropPresence, expirePresence, hasConnection, heartbeat, sendTo, presenceList, type Connection } from './hub.js'
import { endConnection, listHolds, registerConnection, sweepStaleConnections, touchConnections } from './holds.js'
import { sameOrigin } from './http.js'
import { loadScore } from './state.js'
import { instanceId, valkeyLive } from './valkey.js'

const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 })
const PING_MS = 10_000

function refuse(socket: Duplex, error: unknown): void {
  const { status, body } = toResponse(error)
  const payload = JSON.stringify(body)
  socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Error'}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(payload)}\r\nconnection: close\r\n\r\n${payload}`)
  socket.destroy()
}

async function accept(req: IncomingMessage, socket: Duplex, head: Buffer, scoreId: string, token: string | null): Promise<void> {
  try {
    if (!sameOrigin(req)) throw new ApiError(403, 'cross_origin', 'Requests must come from Fairline itself.')
    const seat = await seatFor(token ?? undefined)
    const state = await loadScore(scoreId)
    if (state.id !== seat.score_id) throw new ApiError(404, 'not_found', 'Not found.')
    const connectionId = `conn-${randomUUID()}`
    await registerConnection(connectionId, scoreId, seat.id, instanceId)
    if (socket.destroyed) {
      await endConnection(connectionId, scoreId)
      return
    }
    const ws = await new Promise<WebSocket>((resolve) => wss.handleUpgrade(req, socket, head, resolve))
    const connection: Connection = { id: connectionId, ws, seat, scoreId, awaitingPong: false }
    addConnection(connection)
    ws.on('pong', () => {
      connection.awaitingPong = false
    })
    ws.on('message', (data) => void onMessage(connection, data.toString()))
    ws.on('close', () => void onClose(connection))
    ws.on('error', () => undefined)
    sendTo(connection, { type: 'welcome', connectionId: connection.id, lamport: state.row.lamport, lastSeq: state.row.last_seq, live: valkeyLive() })
    sendTo(connection, { type: 'holds', holds: await listHolds(scoreId) })
    sendTo(connection, { type: 'presence', entries: await presenceList(scoreId) })
  } catch (error) {
    refuse(socket, error)
  }
}

async function onMessage(connection: Connection, text: string): Promise<void> {
  try {
    const message = JSON.parse(text) as Partial<ClientHeartbeat>
    if (message.type !== 'heartbeat') return
    const cursor = parseCursor(message.cursor)
    if (typeof message.seen === 'number' && Number.isInteger(message.seen) && message.seen > 0) {
      await query('UPDATE collaborators SET ack_lamport = $2 WHERE id = $1 AND ack_lamport < $2', [connection.seat.id, message.seen])
    }
    await heartbeat(connection.seat, connection.scoreId, cursor)
  } catch {
    // a malformed or failed heartbeat is ignored: the next one restores the entry
  }
}

function parseCursor(value: unknown): PresenceCursor | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>
  return typeof c.staffId === 'string' && typeof c.measure === 'number' && typeof c.beat === 'number'
    ? { staffId: c.staffId, measure: c.measure, beat: c.beat }
    : null
}

async function onClose(connection: Connection): Promise<void> {
  dropConnection(connection.id)
  try {
    await endConnection(connection.id, connection.scoreId)
    if (!hasConnection(connection.scoreId, connection.seat.id)) await dropPresence(connection.scoreId, connection.seat.id)
  } catch {
    // a database outage while closing is cleaned up by the stale-connection sweep
  }
}

export function startLive(server: Server): void {
  server.on('upgrade', (req, socket, head) => {
    // Node drops its own socket error handler before emitting 'upgrade'; a reset during accept() must not crash the server.
    socket.on('error', () => socket.destroy())
    const url = new URL(req.url ?? '/', 'http://localhost')
    const match = /^\/api\/scores\/([^/]+)\/live$/.exec(url.pathname)
    if (!match) {
      socket.destroy()
      return
    }
    let scoreId: string
    try {
      scoreId = decodeURIComponent(match[1] as string)
    } catch {
      socket.destroy()
      return
    }
    if (scoreId.includes('\0')) {
      socket.destroy()
      return
    }
    void accept(req, socket, head, scoreId, url.searchParams.get('token'))
  })
  setInterval(() => {
    const open = [...allConnections()]
    for (const c of open) {
      if (c.awaitingPong || c.ws.readyState !== c.ws.OPEN) c.ws.terminate()
      else {
        c.awaitingPong = true
        c.ws.ping()
      }
    }
    touchConnections(open.map((c) => c.id)).then(sweepStaleConnections).catch(() => undefined)
  }, PING_MS).unref()
  setInterval(expirePresence, 1000).unref()
}

export function stopLive(): void {
  for (const c of allConnections()) c.ws.terminate()
}
