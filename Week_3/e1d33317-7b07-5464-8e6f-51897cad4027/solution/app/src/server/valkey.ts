// Valkey: score broadcast channels and the presence hash.
// While Valkey is unreachable every operation here fails fast and callers fall back to this instance.

import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { config } from './config.js'
import type { PresenceEntry, ServerMessage } from '../shared/protocol.js'

/** What instances tell each other: client messages, plus a private order to close a removed collaborator's sockets. */
export type BusMessage = ServerMessage | { type: 'evict'; collaboratorId: string }

export const instanceId = randomUUID()

const RETRY_MS = 5000
const FIRST_CONNECT_MS = 1500
const channelOf = (scoreId: string): string => `fairline:score:${scoreId}`
const presenceKey = (scoreId: string): string => `fairline:presence:${scoreId}`

type Listener = (scoreId: string, message: BusMessage) => void

let commands: Redis | null = null
let subscriber: Redis | null = null
let isLive = false
const listeners = new Set<Listener>()
const liveListeners = new Set<(live: boolean) => void>()

export const valkeyLive = (): boolean => isLive

function setLive(next: boolean): void {
  if (next === isLive) return
  isLive = next
  for (const listener of liveListeners) listener(next)
}

function connect(): Redis | null {
  if (!config.valkeyUrl) return null
  const client = new Redis(config.valkeyUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 3000,
    commandTimeout: 3000,
    retryStrategy: () => RETRY_MS,
    autoResubscribe: true,
  })
  client.on('error', () => undefined)
  return client
}

/** Starts the connections; resolves once Valkey answered, refused, or a short wait passed. */
export function startValkey(): Promise<void> {
  commands = connect()
  subscriber = connect()
  if (!commands || !subscriber) return Promise.resolve()
  const refresh = (): void => setLive(commands?.status === 'ready' && subscriber?.status === 'ready')
  for (const client of [commands, subscriber]) {
    client.on('ready', refresh)
    client.on('close', refresh)
    client.on('end', refresh)
  }
  subscriber.on('ready', () => {
    subscriber?.psubscribe('fairline:score:*').catch(() => undefined)
  })
  subscriber.on('pmessage', (_pattern, channel, payload) => {
    let parsed: { origin: string; message: BusMessage }
    try {
      parsed = JSON.parse(payload) as { origin: string; message: BusMessage }
    } catch {
      return
    }
    if (parsed.origin === instanceId) return
    const scoreId = channel.slice('fairline:score:'.length)
    for (const listener of listeners) listener(scoreId, parsed.message)
  })
  const settled = Promise.allSettled([commands.connect(), subscriber.connect()])
  return Promise.race([settled, new Promise((resolve) => setTimeout(resolve, FIRST_CONNECT_MS))]).then(() => undefined)
}

export function stopValkey(): void {
  commands?.disconnect()
  subscriber?.disconnect()
}

export function onRemoteMessage(listener: Listener): void {
  listeners.add(listener)
}

export function onLiveChange(listener: (live: boolean) => void): void {
  liveListeners.add(listener)
}

/** Publishes to the other server instances; this instance delivers to its own sockets directly. */
export function publish(scoreId: string, message: BusMessage): void {
  if (!isLive) return
  commands?.publish(channelOf(scoreId), JSON.stringify({ origin: instanceId, message })).catch(() => undefined)
}

export async function presenceSet(scoreId: string, entry: PresenceEntry): Promise<void> {
  if (!isLive) return
  await commands?.hset(presenceKey(scoreId), entry.collaboratorId, JSON.stringify({ name: entry.name, role: entry.role, cursor: entry.cursor })).catch(() => undefined)
}

export async function presenceRemove(scoreId: string, collaboratorId: string): Promise<void> {
  if (!isLive) return
  await commands?.hdel(presenceKey(scoreId), collaboratorId).catch(() => undefined)
}

/** The shared presence list, or null while Valkey is unreachable. */
export async function presenceRead(scoreId: string): Promise<PresenceEntry[] | null> {
  if (!isLive || !commands) return null
  try {
    const hash = await commands.hgetall(presenceKey(scoreId))
    return Object.entries(hash).map(([collaboratorId, value]) => ({ collaboratorId, ...(JSON.parse(value) as Omit<PresenceEntry, 'collaboratorId'>) }))
  } catch {
    return null
  }
}
