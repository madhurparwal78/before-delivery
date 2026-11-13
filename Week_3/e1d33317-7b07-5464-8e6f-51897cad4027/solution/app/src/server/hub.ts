// Live connections, broadcasts and presence. Presence is decided only here, on the server clock.

import type { WebSocket } from 'ws'
import type { Collaborator, PresenceCursor, PresenceEntry, ServerMessage } from '../shared/protocol.js'
import { config } from './config.js'
import type { Seat } from './auth.js'
import { onLiveChange, onRemoteMessage, presenceRead, presenceRemove, presenceSet, publish, type BusMessage } from './valkey.js'

export interface Connection {
  id: string
  ws: WebSocket
  seat: Seat
  scoreId: string
  awaitingPong: boolean
}

const connections = new Map<string, Connection>()
const presence = new Map<string, Map<string, { entry: PresenceEntry; lastBeat: number }>>()

export const addConnection = (c: Connection): void => void connections.set(c.id, c)
export const dropConnection = (id: string): void => void connections.delete(id)
export const allConnections = (): Iterable<Connection> => connections.values()

const connectionsOf = (scoreId: string, collaboratorId?: string): Connection[] =>
  [...connections.values()].filter((c) => c.scoreId === scoreId && (!collaboratorId || c.seat.id === collaboratorId))

export const hasConnection = (scoreId: string, collaboratorId: string): boolean => connectionsOf(scoreId, collaboratorId).length > 0

function deliver(scoreId: string, message: ServerMessage): void {
  for (const c of connectionsOf(scoreId)) {
    if (c.ws.readyState !== c.ws.OPEN) continue
    let out: ServerMessage = message
    if (message.type === 'collaborators' && c.seat.role === 'player') {
      out = { type: 'collaborators', collaborators: message.collaborators.filter((p: Collaborator) => p.status === 'active') }
    }
    c.ws.send(JSON.stringify(out))
  }
}

/** To every socket on this instance now, and to the other instances through Valkey. */
export function broadcast(scoreId: string, message: ServerMessage): void {
  deliver(scoreId, message)
  publish(scoreId, message)
}

export function sendTo(connection: Connection, message: ServerMessage): void {
  if (connection.ws.readyState === connection.ws.OPEN) connection.ws.send(JSON.stringify(message))
}

/** Closes every socket of a removed collaborator, here and on the other instances. */
export function evict(scoreId: string, collaboratorId: string): void {
  closeSockets(scoreId, collaboratorId)
  publish(scoreId, { type: 'evict', collaboratorId })
}

function closeSockets(scoreId: string, collaboratorId: string): void {
  for (const c of connectionsOf(scoreId, collaboratorId)) {
    sendTo(c, { type: 'removed' })
    c.ws.close(4001, 'removed')
  }
}

onRemoteMessage((scoreId: string, message: BusMessage) => {
  if (message.type === 'evict') closeSockets(scoreId, message.collaboratorId)
  else deliver(scoreId, message)
})

onLiveChange((live) => {
  for (const scoreId of new Set([...connections.values()].map((c) => c.scoreId))) {
    deliver(scoreId, { type: 'live', live })
    if (live) void republishPresence(scoreId)
  }
})

async function republishPresence(scoreId: string): Promise<void> {
  for (const { entry } of presence.get(scoreId)?.values() ?? []) await presenceSet(scoreId, entry)
  await pushPresence(scoreId)
}

export async function presenceList(scoreId: string): Promise<PresenceEntry[]> {
  const shared = await presenceRead(scoreId)
  return shared ?? [...(presence.get(scoreId)?.values() ?? [])].map((p) => p.entry)
}

async function pushPresence(scoreId: string): Promise<void> {
  broadcast(scoreId, { type: 'presence', entries: await presenceList(scoreId) })
}

const sameCursor = (a: PresenceCursor | null, b: PresenceCursor | null): boolean =>
  a === b || (!!a && !!b && a.staffId === b.staffId && a.measure === b.measure && a.beat === b.beat)

/** A heartbeat creates or refreshes the collaborator's entry; clients are told only when it changed. */
export async function heartbeat(seat: Seat, scoreId: string, cursor: PresenceCursor | null): Promise<void> {
  const book = presence.get(scoreId) ?? new Map()
  presence.set(scoreId, book)
  const known = book.get(seat.id)
  const entry: PresenceEntry = { collaboratorId: seat.id, name: seat.name, role: seat.role, cursor }
  book.set(seat.id, { entry, lastBeat: Date.now() })
  if (known && sameCursor(known.entry.cursor, cursor)) return
  await presenceSet(scoreId, entry)
  await pushPresence(scoreId)
}

export async function dropPresence(scoreId: string, collaboratorId: string): Promise<void> {
  const removed = presence.get(scoreId)?.delete(collaboratorId)
  await presenceRemove(scoreId, collaboratorId)
  if (removed !== undefined) await pushPresence(scoreId)
}

/** Expires entries whose last heartbeat is older than the presence window. */
export function expirePresence(): void {
  const limit = Date.now() - config.presenceTtlSeconds * 1000
  for (const [scoreId, book] of presence) {
    for (const [collaboratorId, { lastBeat }] of book) {
      if (lastBeat < limit) void dropPresence(scoreId, collaboratorId)
    }
  }
}

